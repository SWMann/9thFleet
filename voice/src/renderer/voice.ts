import {
  ConnectionState,
  DisconnectReason,
  LocalAudioTrack,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
  type TrackPublication,
} from 'livekit-client';
import { routeFor, type NetConfig } from '../shared/nets';

/**
 * One event room, one connection per member, one audio track per net.
 *
 * Sending: the microphone is opened once and cloned into one track per net. Every track is
 * published muted. Holding a net's key unmutes that net's track and nothing else, so there is
 * no message to send before speaking and no delay when changing nets.
 *
 * Receiving: nothing is subscribed automatically. The app subscribes only to tracks named for
 * a net it monitors, and plays each through its own pan and volume.
 */

export type LinkState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface RosterEntry {
  identity: string;
  name: string;
  isLocal: boolean;
  /** Net ids this member is transmitting on right now. */
  talkingOn: string[];
}

export interface VoiceHandlers {
  onState(state: LinkState, detail: string): void;
  onRoster(): void;
  onLog(line: string): void;
  /** A remote transmission ended. Duration is measured on this PC. */
  onReceived(name: string, netId: string, seconds: number): void;
}

interface Receiver {
  netId: string;
  track: RemoteAudioTrack;
  panner: StereoPannerNode;
  gain: GainNode;
}

export class VoiceSession {
  readonly audio = new AudioContext({ latencyHint: 'interactive' });
  private room: Room | null = null;
  private mic: MediaStream | null = null;
  private readonly senders = new Map<string, LocalAudioTrack>();
  private readonly receivers = new Map<string, Receiver>();
  private readonly receiveStart = new Map<string, number>();
  private nets: NetConfig[] = [];
  private state: LinkState = 'disconnected';

  constructor(private readonly handlers: VoiceHandlers) {}

  get linkState(): LinkState {
    return this.state;
  }

  get roomName(): string {
    return this.room?.name ?? '';
  }

  get selfName(): string {
    const local = this.room?.localParticipant;
    return local ? local.name || local.identity : '';
  }

  /** The open microphone stream, for the level meter. */
  get micStream(): MediaStream | null {
    return this.mic;
  }

  async connect(url: string, token: string, micDeviceId: string, nets: NetConfig[]): Promise<void> {
    if (this.room) await this.disconnect();
    this.nets = nets.map((net) => ({ ...net }));
    this.setState('connecting', '');

    const room = new Room({
      webAudioMix: { audioContext: this.audio },
      adaptiveStream: false,
      dynacast: false,
      publishDefaults: { dtx: true, red: true, stopMicTrackOnMute: false },
    });
    this.room = room;
    this.wire(room);

    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: micDeviceId ? { exact: micDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      const source = this.mic.getAudioTracks()[0];
      if (!source) throw new Error('No microphone track');
      source.addEventListener('ended', () => {
        this.handlers.onLog('ERROR microphone lost. Reconnect to open it again.');
      });

      await room.connect(url, token, { autoSubscribe: false });

      for (const net of this.nets) {
        const track = new LocalAudioTrack(source.clone(), undefined, true);
        await track.mute();
        await room.localParticipant.publishTrack(track, {
          name: net.id,
          source: Track.Source.Microphone,
          dtx: true,
          red: true,
        });
        this.senders.set(net.id, track);
      }

      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          this.considerSubscription(publication as RemoteTrackPublication);
        }
      }
      await room.startAudio().catch(() => undefined);
      if (this.audio.state !== 'running') await this.audio.resume().catch(() => undefined);

      this.setState('connected', '');
      this.handlers.onLog(
        `CONNECTED room "${room.name}" as "${this.selfName}", ${room.remoteParticipants.size} other(s) present`,
      );
      this.handlers.onRoster();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.teardown();
      this.setState('disconnected', message);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.teardown();
    this.setState('disconnected', '');
    this.handlers.onRoster();
  }

  /** Opens the microphone on one net. Resolves once the track is live. */
  async key(netId: string): Promise<void> {
    const track = this.senders.get(netId);
    if (!track || this.state !== 'connected') throw new Error('Not connected');
    await track.unmute();
  }

  /** Closes the microphone on one net. Safe to call at any time. */
  async unkey(netId: string): Promise<void> {
    await this.senders.get(netId)?.mute();
  }

  /** Closes the microphone on every net. */
  async unkeyAll(): Promise<void> {
    await Promise.all([...this.senders.values()].map((track) => track.mute()));
  }

  /** True while any of this member's net tracks is open. */
  get transmitting(): boolean {
    for (const track of this.senders.values()) if (!track.isMuted) return true;
    return false;
  }

  /** Applies changed monitor, ear and volume settings. */
  applyNets(nets: NetConfig[]): void {
    this.nets = nets.map((net) => ({ ...net }));
    const room = this.room;
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        this.considerSubscription(publication as RemoteTrackPublication);
      }
    }
    for (const receiver of this.receivers.values()) this.applyRoute(receiver);
  }

  roster(): RosterEntry[] {
    const room = this.room;
    if (!room || this.state === 'disconnected') return [];
    const entries: RosterEntry[] = [];
    const local = room.localParticipant;
    entries.push({
      identity: local.identity,
      name: local.name || local.identity,
      isLocal: true,
      talkingOn: [...this.senders.entries()].filter(([, track]) => !track.isMuted).map(([netId]) => netId),
    });
    for (const participant of room.remoteParticipants.values()) {
      entries.push({
        identity: participant.identity,
        name: participant.name || participant.identity,
        isLocal: false,
        talkingOn: [...participant.trackPublications.values()]
          .filter((publication) => publication.kind === Track.Kind.Audio && !publication.isMuted)
          .map((publication) => publication.trackName),
      });
    }
    return entries;
  }

  /** Names of other members transmitting on a net right now. */
  talkers(netId: string): string[] {
    return this.roster()
      .filter((entry) => !entry.isLocal && entry.talkingOn.includes(netId))
      .map((entry) => entry.name);
  }

  private wire(room: Room): void {
    room
      .on(RoomEvent.TrackPublished, (publication) => this.considerSubscription(publication))
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) =>
        this.onSubscribed(track, publication, participant),
      )
      .on(RoomEvent.TrackUnsubscribed, (track, publication) => this.onUnsubscribed(track, publication))
      .on(RoomEvent.TrackUnpublished, (publication, participant) => {
        this.endReceive(publication, participant);
        this.handlers.onRoster();
      })
      .on(RoomEvent.TrackUnmuted, (publication, participant) => this.onMuteChange(publication, participant, false))
      .on(RoomEvent.TrackMuted, (publication, participant) => this.onMuteChange(publication, participant, true))
      .on(RoomEvent.ParticipantConnected, (participant) => {
        this.handlers.onLog(`JOINED ${participant.name || participant.identity}`);
        this.handlers.onRoster();
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        for (const publication of participant.trackPublications.values()) this.endReceive(publication, participant);
        this.handlers.onLog(`LEFT ${participant.name || participant.identity}`);
        this.handlers.onRoster();
      })
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
          this.setState('reconnecting', '');
          this.handlers.onLog('LINK reconnecting');
        } else if (state === ConnectionState.Connected && this.state === 'reconnecting') {
          this.setState('connected', '');
          this.handlers.onLog('LINK reconnected');
        }
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (this.room !== room) return;
        const detail = reason === undefined ? 'unknown reason' : (DisconnectReason[reason] ?? String(reason));
        this.handlers.onLog(`LINK disconnected (${detail})`);
        void this.teardown().then(() => {
          this.setState('disconnected', detail);
          this.handlers.onRoster();
        });
      })
      .on(RoomEvent.MediaDevicesError, (error) => {
        this.handlers.onLog(`ERROR audio device: ${error.message}`);
      });
  }

  private netFor(netId: string): NetConfig | undefined {
    return this.nets.find((net) => net.id === netId);
  }

  private considerSubscription(publication: RemoteTrackPublication): void {
    if (publication.kind !== Track.Kind.Audio) return;
    const wanted = this.netFor(publication.trackName)?.monitor === true;
    if (publication.isDesired !== wanted) publication.setSubscribed(wanted);
  }

  private onSubscribed(track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant): void {
    if (!(track instanceof RemoteAudioTrack)) return;
    const panner = new StereoPannerNode(this.audio);
    const gain = new GainNode(this.audio);
    const receiver: Receiver = { netId: publication.trackName, track, panner, gain };
    this.applyRoute(receiver);
    // The track must be routed through our audio graph before it is attached,
    // otherwise it would play unpanned through a plain audio element.
    track.setAudioContext(this.audio);
    track.setWebAudioPlugins([panner, gain]);
    track.attach();
    this.receivers.set(publication.trackSid, receiver);
    if (!publication.isMuted) this.onMuteChange(publication, participant, false);
  }

  private onUnsubscribed(track: RemoteTrack, publication: RemoteTrackPublication): void {
    track.detach();
    const receiver = this.receivers.get(publication.trackSid);
    if (receiver) {
      receiver.panner.disconnect();
      receiver.gain.disconnect();
      this.receivers.delete(publication.trackSid);
    }
    this.receiveStart.delete(publication.trackSid);
    this.handlers.onRoster();
  }

  private applyRoute(receiver: Receiver): void {
    const route = routeFor(this.netFor(receiver.netId));
    receiver.panner.pan.value = route.pan;
    receiver.gain.gain.value = route.gain;
  }

  private onMuteChange(publication: TrackPublication, participant: Participant, muted: boolean): void {
    if (participant.isLocal || publication.kind !== Track.Kind.Audio) return;
    if (muted) {
      this.endReceive(publication, participant);
    } else if (this.receivers.has(publication.trackSid) || this.netFor(publication.trackName)?.monitor) {
      this.receiveStart.set(publication.trackSid, performance.now());
    }
    this.handlers.onRoster();
  }

  private endReceive(publication: TrackPublication, participant: Participant): void {
    const started = this.receiveStart.get(publication.trackSid);
    if (started === undefined) return;
    this.receiveStart.delete(publication.trackSid);
    const seconds = (performance.now() - started) / 1000;
    this.handlers.onReceived(participant.name || participant.identity, publication.trackName, seconds);
  }

  private async teardown(): Promise<void> {
    const room = this.room;
    this.room = null;
    for (const track of this.senders.values()) track.stop();
    this.senders.clear();
    for (const receiver of this.receivers.values()) {
      receiver.track.detach();
      receiver.panner.disconnect();
      receiver.gain.disconnect();
    }
    this.receivers.clear();
    this.receiveStart.clear();
    if (this.mic) {
      for (const track of this.mic.getTracks()) track.stop();
      this.mic = null;
    }
    // Handlers stay attached: each one checks that it still belongs to the current room.
    if (room) await room.disconnect().catch(() => undefined);
  }

  private setState(state: LinkState, detail: string): void {
    this.state = state;
    this.handlers.onState(state, detail);
  }
}
