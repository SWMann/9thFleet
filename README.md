# UEE 9th Fleet

Tools for the UEE 9th Fleet, a Star Citizen organisation.

| Folder | What it is | State |
| --- | --- | --- |
| [`voice/`](voice/README.md) | The Windows voice app that carries the radio nets | Gate A spike: two nets, global push-to-talk |
| [`web/`](web/README.md) | The fleet's website | Public pages, Discord sign-in, the member's record, the order of battle, applying, operations and training nights, and the staff and admin pages |
| [`supabase/`](supabase/README.md) | The database: members, the order of battle, recruiting, events and the access rules | Applied to the live database |
| [`docs/`](docs/gate-a-test.md) | Test scripts and records | Gate A test script |

No keys or secrets belong in this repository. LiveKit keys live in `voice/.env`, which git ignores.
