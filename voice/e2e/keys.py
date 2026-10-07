"""Sends real operating-system key events, the kind a global key hook sees.

Linux uses the X11 XTEST extension (needs python-xlib and an X display such as Xvfb).
Windows uses keybd_event from user32.

    keys.py down F5
    keys.py up F5
    keys.py taps COUNT HOLD_MS GAP_MS F5
"""
import sys
import time

if sys.platform == "win32":
    import ctypes

    VIRTUAL_KEYS = {"F5": 0x74, "F6": 0x75, "F7": 0x76, "F8": 0x77, "Escape": 0x1B}
    KEYEVENTF_KEYUP = 0x0002

    def send(kind, name):
        key = VIRTUAL_KEYS[name]
        scan = ctypes.windll.user32.MapVirtualKeyW(key, 0)
        ctypes.windll.user32.keybd_event(key, scan, 0 if kind == "down" else KEYEVENTF_KEYUP, 0)

else:
    from Xlib import X, XK, display
    from Xlib.ext import xtest

    DISPLAY = display.Display()

    def send(kind, name):
        keysym = XK.string_to_keysym(name)
        if keysym == 0:
            raise SystemExit(f"unknown key {name}")
        event = X.KeyPress if kind == "down" else X.KeyRelease
        xtest.fake_input(DISPLAY, event, DISPLAY.keysym_to_keycode(keysym))
        DISPLAY.sync()


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action in ("down", "up") and len(sys.argv) == 3:
        send(action, sys.argv[2])
    elif action == "taps" and len(sys.argv) == 6:
        count, hold_ms, gap_ms, name = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
        for _ in range(count):
            send("down", name)
            time.sleep(hold_ms / 1000)
            send("up", name)
            time.sleep(gap_ms / 1000)
    else:
        raise SystemExit(__doc__)


main()
