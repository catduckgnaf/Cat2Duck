# Toduck for Android

> **New app identity:** Toduck's Android app id is `app.toduck`. The
> pre-rename app (`app.cadence`, shipped as Cadence/Cat2Duck) will **not**
> update in place — uninstall the old app and install Toduck fresh. The
> old app's local data goes with the uninstall; anything synced to a
> self-hosted server is unaffected and comes back when you connect
> Toduck to the same server.

Open this folder in Android Studio and let Gradle sync. Run it on a phone or emulator, then long-press the home screen and add the Toduck widget.

Each repeating task is one row: the next time only. Checking it off moves that same task to the following time.

To share the list with the web app, run the server in `selfhost` and enter its address and token in Settings on both the phone and the website.
