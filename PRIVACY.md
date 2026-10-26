# Privacy policy

Applies to the browser extension **UrBackup Theme+** (Chrome, Edge and other
Chromium browsers).

## Summary

The extension does not collect, store or transmit any personal data. There is no
analytics, no telemetry, no advertising, no cookie and no remote code.

## What it does with the page

It reads and restyles the UrBackup web interface in the tab where you turned it on.
That happens inside your browser. Page content is never sent to the author, to a
server or to a third party.

The extension only acts on pages where it was enabled: the UrBackup addresses it
ships with (`localhost`, `127.0.0.1`) and every other server you add yourself on
the options page, one origin at a time. It never reads a page you did not point it
at.

## What it stores

Your settings: which optional features are on, and the list of servers you added.
They live in `chrome.storage.sync`, which belongs to your browser profile, and they
are removed when you uninstall the extension. Nothing else is kept.

The UrBackup password is not read and not stored. On the login page the extension
only adds standard `autocomplete` attributes, so your own password manager can fill
the form.

## Network requests

None, apart from loading the files that ship inside the extension package.

## Permissions and why they exist

- `storage`: keep the feature switches and the server list.
- `scripting`: register the theme's files for the servers you enabled, and apply
  them to the tab you just clicked without a reload.
- `activeTab`: the toolbar click is the only moment the extension touches a page it
  has no standing access to.
- `declarativeContent`: decide whether the toolbar icon is shown. Read only, it
  injects nothing.
- Host access: `localhost` and `127.0.0.1` are UrBackup's default address. Any other
  server is requested at runtime, from the options page, at your command.

## Changes

If this policy changes, the new version is published in this file, in the same
repository.

## Contact

Questions and reports go to the issue tracker:
<https://github.com/ena-ean/urbackup-theme-plus/issues>

UrBackup Theme+ is not affiliated with the UrBackup project.
