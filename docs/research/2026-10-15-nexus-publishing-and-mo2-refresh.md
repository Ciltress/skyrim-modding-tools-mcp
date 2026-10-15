# Research: Nexus publishing API and MO2 `refresh` semantics

Gathered 2026-10-15. Primary sources: the live Nexus OpenAPI spec (fetched today), Nexus's own GitHub
repos, and the MO2 source code (master `4ba22f0`, 2026-10-05, checked against the v2.5.2 tag).

## 1. Publishing to Nexus Mods via API (v3 "Upload API")

### Status and who can use it
- The Upload API went to **open beta around March 2026**, after a closed test with Verified Mod Authors.
  The first phase is "focused on updating your mods". It uses API keys, and anyone on the mod's team
  can use it. The browser upload form is still available.
  https://www.nexusmods.com/news/15454 (403 to fetchers; quoted from search snippets, **UNVERIFIED** word for word)
- A comment on the same post says the API "is available to any mod author"; nothing says
  Premium-only. Spec: `https://api.nexusmods.com/openapi.yaml` (OpenAPI 3.0.3, `info.version: 3.0.0`),
  rendered at https://api-docs.nexusmods.com/. Base URL: `https://api.nexusmods.com/v3`.
- Stability badges in the spec: none = Stable (90-day deprecation), **Beta** (10-day),
  **Experimental** ("may change significantly or be removed").
- **Auth:** `ApiKeyAuth` is the header `apikey: <personal key from
  https://www.nexusmods.com/settings/api-keys>`. `BearerJwtAuth` is `Authorization: Bearer <JWT>`.
  A third scheme, `ServiceJwtAuth` (client_credentials with scopes), is staff-only and only used
  for quarantine. **No OAuth scopes apply to the upload endpoints**: a personal key works. Both
  the official GitHub Action and BUTR's uploader use only the `apikey` header.
  https://raw.githubusercontent.com/Nexus-Mods/upload-action/main/src/index.ts

### Endpoints (from the spec, fetched 2026-10-15)
| Step | Endpoint | Badge |
|---|---|---|
| 1a. Single-part session (up to 100 MiB) | `POST /uploads` `{size_bytes, filename, md5?}` returns `{id, presigned_url, state}` | Stable (**md5 required from 2026-12-01**) |
| 1b. Multipart session (required above 100 MiB) | `POST /uploads/multipart` `{size_bytes, filename, crc64nvme?}` returns `{part_size_bytes, part_presigned_urls[], complete_presigned_url}` | Stable |
| 2. Send the bytes | `PUT presigned_url`, with the headers `Content-Disposition: attachment; filename="<filename>"` and, if md5 was given, `Content-MD5: <base64>`. For multipart: PUT each part, collect the `ETag`s, then POST the S3 `<CompleteMultipartUpload>` XML to `complete_presigned_url` | n/a (S3) |
| 3. Close the session | `POST /uploads/{id}/finalise` | Stable |
| 4. Wait | `GET /uploads/{id}` until `state` changes from `created` to `available` | Stable |
| 5a. New version of an existing file | `POST /mod-files/{id}/versions` | **Experimental** |
| 5b. New file on an existing mod page | `POST /mod-files` (also needs `mod_id`) | **Experimental** |
| (old 5a) | `POST /mod-file-update-groups/{group_id}/versions`, **deprecated 2026-06-11, "removed on or after 2026-09-09"**. Still answered 422, not 404, on 2026-10-15 | Stable, deprecated |
| Changelog | `POST /mods/{id}/changelogs` `{version, changelog (≤65535)}`. Append-only: a repeat call adds text | Experimental |
| Mod page text | `PATCH /mods/{id}` `{summary (≤350), description (BBCode)}`. Caller must be on the mod's team | Experimental |
| Rename a file | `PUT /mod-files/{id}` `{name (≤255)}` | Experimental |
| Your own mods | `GET /team-mods`, `GET /mods/{id}/files`, `GET /games/{domain}/mods/{game_scoped_id}` (getMod) | Experimental |

- **A new mod page cannot be created through the API.** The spec has no `POST /mods`, and a POST
  to `/v3/mods` returns 404, while `/v3/mod-files` returns 422 (probed today with no key, so
  nothing ran). Every tool reviewed requires an existing mod page.
- Metadata for 5a and 5b (`CreateModFileVersionRequest` / `CreateModFileRequest`):
  - Required: `upload_id`, `name`, `version`, `file_category`.
    - `name` matches `^[a-zA-Z0-9 _'().-]+$`, at most 50 characters.
    - `version` matches `^[a-zA-Z0-9.-]+$`, at most 50 characters. **No `+`, spaces or underscores.**
    - `file_category` takes only **`main | optional | miscellaneous`** (`NewModFileCategory`).
      **"update" and "old_version" cannot be set on upload**, although they exist in the read-side
      enum.
  - Optional:
    - `description`.
    - The flags `primary_mod_manager_download`, `allow_mod_manager_download`,
      `show_requirements_pop_up` and `update_mod_version` (default false; sets the mod page's
      headline version).
    - For 5a only: `archive_existing_file` (default false) and `previous_version_id`.
  - 5b also requires `mod_id`. This is the **global** mod id, not the game-scoped one in the URL;
    getMod converts between them.
- The changelog is **not** a field of the file-version call. It is a separate call to
  `/mods/{id}/changelogs`, which the official action makes afterwards.
- The upload `filename` is only the archive name sent in `Content-Disposition`. The display name
  is `name`.
- **File size:** the API states only the 100 MiB threshold for single-part uploads; it gives no
  maximum. The only official cap found is an old news post, "File upload limit raised to 5GB"
  (undated, many years old). https://www.nexusmods.com/news/701 The current cap is **UNVERIFIED**.
- **Rate limits for v3:** none documented in the spec. Anonymous v3 responses carry no rate-limit
  headers (checked today). Whether v3 shares the v1 20k/day quota is **UNVERIFIED**.
- **Processing:** the official action polls `GET /uploads/{id}` every 2 s with ×1.5 backoff, capped
  at 30 s. Nexus says uploads are "fully integrated with our virus scanning". Whether a new version
  is public at once or after a scan is **UNVERIFIED**.
- **Known bug** (forum, 2026): files added through `POST /v3/mod-files` leave mod *search* results
  with stale metadata, although the mod page itself is correct.
  https://forums.nexusmods.com/topic/13535709-mod-search-results-show-stale-data-when-using-api-upload/
  (seen in a search snippet only)

### Terms of use
- The API AUP (last updated 2020-12-01) "tolerate[s]" personal keys for testing and personal use.
  It forbids "Using personal API keys for a public-facing application", and "Storing user API keys
  on your own server and/or using them without the action being initiated by the user". It asks
  for `Application-Name` and `Application-Version` headers. **It says nothing about uploads.**
  https://help.nexusmods.com/article/114-api-acceptable-use-policy
- The site ToS (updated 2026-05-12), §11, bans bots, scrapers and other "automated device[s]" for
  accessing or copying site content. It bans text and data mining, and using the site for AI
  training. §10 bans downloading far beyond normal usage. **No clause covers automated uploads**
  through the API. https://help.nexusmods.com/article/18-terms-of-service
- So for an MCP server: uploads must be user-initiated (AUP), and must go through the API, not by
  driving the website (ToS §11). A personal key is acceptable for personal use. A distributed tool
  should register with Nexus (support@nexusmods.com).

### Tools that already upload (what works in practice)
- **Nexus-Mods/upload-action** (official, MIT; tags `v1.0.0-beta.1` to `beta.11`; last commit
  2026-09-10).
  - Mechanism: the v3 API with the `apikey` header. It always uses multipart, then finalise, then
    polls, then calls `POST /mod-files/{id}/versions`, then optionally `POST /mods/{id}/changelogs`.
  - Inputs: `api_key`, `file_id`, `filename`, `version`, `display_name`, `description`, `category`,
    `archive_existing_version`, `update_mod_version` (added 2026-07-14), `mod_id` and `changelog`.
  - It **only adds versions to an existing file**: you must already have a mod page with one file.
  - The file id is shown through the "Advanced" option on the Files tab.
  - It moved off the deprecated update-group endpoint on 2026-06-17.
  - https://github.com/Nexus-Mods/upload-action, https://github.com/Nexus-Mods/API-Example
- **BUTR.NexusUploader** (`unex`, a fork of agc93/nexus-uploader). From v4.0.0 it uses the
  official v3 API and needs only an API key; earlier versions used **session cookies** (website
  scraping), now removed. It can add a version, **create a new file when no file id is given**,
  post changelogs, and bump the mod version by default. https://github.com/BUTR/BUTR.NexusUploader
- **Digitalroot.ModUploader** (NuGet) needs an API key **plus a session cookie**, so it uses the
  website path, not v3. https://www.nuget.org/packages/Digitalroot.ModUploader (search snippet)
- **PHLemp/nexus-mods-mcp** is an MCP server with `nexus_upload_mod_file`. It runs the same v3
  flow, uses `mod_file_id` to add a version or omits it to create a file, and supports `dry_run`.
  Writes are gated behind `NEXUS_ALLOW_WRITES` and `NEXUS_ALLOW_UPLOADS`.
  https://glama.ai/mcp/servers/PHLemp/nexus-mods-mcp/tools/nexus_upload_mod_file
- Real-world gotcha: DaymareOn/hdtSMP64#374 (2026-06-20). Uploading through the old endpoint did
  not change the mod page's headline version; `update_mod_version` is the fix.
  https://github.com/DaymareOn/hdtSMP64/issues/374
- **No tool was found that creates mod pages**, through the API or by browser automation.

## 2. Mod Organizer 2: `refresh` / F5 and external edits

Permalinks are to master `4ba22f0` (2026-10-05). The same code is in **v2.5.2 (2024-08-04, the
latest tagged release)**: `refresh()`, `RefreshCommand`, `refreshModStatus()`, the multiprocess key
and `externalMessage` were diffed. Repo: https://github.com/ModOrganizer2/modorganizer

### What the command does
- `ModOrganizer.exe refresh` is `RefreshCommand`, described as "refreshes MO (same as F5)".
  `canForwardToPrimary()` returns true and `runPostOrganizer` calls `core.refresh()`. F5
  (`action_Refresh`) calls `on_action_Refresh_triggered`, then `refreshProfile_activated`, then
  `m_OrganizerCore.refresh()`. **So the CLI command and F5 are the same call.**
  src/commandline.cpp L932-946; src/mainwindow.cpp L2386, L2580
- `OrganizerCore::refresh(bool saveChanges = true)` (organizercore.cpp L1278-1293):
  `writeModlistNow(true)` (only if a write is pending), then `updateModInfoFromDisc()`, then
  `m_CurrentProfile->refreshModStatus()`, then `notifyChange(-1)`, then
  `refreshDirectoryStructure()`.
  https://github.com/ModOrganizer2/modorganizer/blob/4ba22f0d8b6f9e08e44008b8395cd774551b4ebe/src/organizercore.cpp#L1278-L1293
- **"Pending" means only within the last 200 ms.** `writeModlistNow(onlyIfPending)` calls
  `DelayedFileWriterBase::writeImmediately(ifOnTimer)`, which writes only
  `if (!ifOnTimer || m_Timer.isActive())`. The timer's default delay is **200 ms** (uibase
  delayedfilewriter.cpp/.h). So refresh clobbers an external edit **only if** the user changed the
  mod list in MO2's UI less than 200 ms earlier.
  https://github.com/ModOrganizer2/modorganizer-uibase/blob/edc09d390348244c2e00d189058140bae5d92934/src/delayedfilewriter.cpp
- **Otherwise MO2 re-reads from disk, it does not write first.**

### Which profile files are re-read
- **modlist.txt is re-read.** `Profile::refreshModStatus()` (profile.cpp L392-583) opens and parses
  it:
  - `+`, `*` and bare lines are enabled, `-` is disabled; the order in the file sets priority.
  - Unknown mods are dropped; mods not in the file are added (foreign mods at the bottom, regular
    mods at the top).
  - If anything was normalised it calls `m_ModListWriter.write()`, which rewrites the file.
  - MO2's own "restore mod list backup" button copies the backup over modlist.txt and then calls
    `refresh(false)`. That is MO2 itself relying on refresh reading from disk (mainwindow.cpp ~L3930).
  https://github.com/ModOrganizer2/modorganizer/blob/4ba22f0d8b6f9e08e44008b8395cd774551b4ebe/src/profile.cpp#L392-L583
- **The mods folder (meta.ini and so on) is rescanned** by `updateModInfoFromDisc()`, which calls
  `ModInfo::updateFromDisc`. The VFS directory tree is rebuilt on a worker thread by
  `refreshDirectoryStructure()`.
- **archives.txt is re-read** by `enabledArchives()`, then rewritten by `refreshBSAList()` through
  `archivesWriter().write()`. That rewrite is delayed by 200 ms.
- **plugins.txt, loadorder.txt and lockedorder.txt are re-read**, but asynchronously: after the
  directory refresh, `onDirectoryRefreshed()` calls `refreshLists()`, which calls
  `refreshESPList(true)`, which calls `PluginList::refresh(..., force=true)`. That clears the list,
  calls `gamePlugins->readPluginLists()` and `readLockedOrderFrom("lockedorder.txt")`.
  pluginlist.cpp L204-341
- **Which file decides the plugin order.** Skyrim SE uses `CreationGamePlugins`, which does not
  override `readPluginLists`, so `GamebryoGamePlugins::readPluginLists` decides by mtime against
  `m_LastRead` (set when MO2 last read or wrote the files):
  - If loadorder.txt is newer, missing, or neither file is newer: the order comes from
    **loadorder.txt**, and active state comes from plugins.txt (`*` means active).
  - If only plugins.txt is newer: **both the order and the active state come from plugins.txt**.
  - **So an external tool should either write both files consistently, or write only plugins.txt
    and leave loadorder.txt older.**
  - lockedorder.txt is reapplied afterwards (`refreshLoadOrder`). Any correction emits
    `writePluginsList`, which rewrites plugins.txt.
  https://github.com/ModOrganizer2/modorganizer-game_bethesda/blob/a6a23403134afe08645aa97d6d376aab9d2ba861/src/gamebryo/gamebryogameplugins.cpp#L39-L62
- **refreshESPList also schedules a modlist.txt rewrite.** It calls
  `m_CurrentProfile->writeModlist()`, which is `DelayedFileWriter::write()` and fires after 200 ms.
  The content is the in-memory list that was just read from disk, so it is harmless but rewrites
  the file: a header comment, CRLF line endings, and normalised lines.
- **A plugin save queued during a refresh can still clobber an external edit.** `savePluginList()`
  is deferred with `onNextRefresh(...)` while a refresh is running, and runs in
  `m_OnNextRefreshCallbacks` *before* `refreshLists()`. If one was queued (from a UI change made
  just before), it writes MO2's in-memory plugins first, and the re-read then sees MO2's own write.
  This is an edge case, inferred from the code (**UNVERIFIED** at runtime).
- **refresh does not re-read** `settings.ini` (a QSettings object is held open) or the INIs.
- **MO2 does not watch profile files.** No `QFileSystemWatcher` covers them; watchers exist only
  for downloads, saves and stylesheets. Without a refresh, MO2 will not notice an external edit.

### When MO2 overwrites external edits without asking
- `OrganizerCore::beforeRun()` runs whenever **any executable or the game is launched** from MO2.
  It calls `saveCurrentProfile()`, which writes modlist.txt and **unconditionally runs
  `savePluginList()`**, writing plugins.txt, loadorder.txt and lockedorder.txt from memory
  (organizercore.cpp L1955-2006).
- `~OrganizerCore()` **on exit** also calls `saveCurrentProfile()`.
- So **an external edit that is not followed by a refresh is lost when the user launches anything
  or closes MO2.** Switching profile in the UI also calls `saveCurrentLists()` (mainwindow.cpp L1745).

### Forwarding and multiple processes
- **There is one primary MO2 process system-wide**, not one per instance.
  `MOMultiProcess` uses the fixed `QSharedMemory` key and `QLocalServer` name
  `mo-43d1a3ad-eeb0-4818-97c9-eda5216c29b5` (multiprocess.cpp L7). A second `ModOrganizer.exe` from
  **any** install or instance becomes "ephemeral" and sends its full command line to the primary,
  then exits with code 0 (main.cpp L50-63). The send is fire-and-forget: no acknowledgement, and
  the refresh runs asynchronously.
- **The primary checks the instance and profile before running the command.**
  `MOApplication::externalMessage` compares `-i <instance>` with the current instance's
  `displayName()` (**"Portable"** for every portable instance) and `-p <profile>` with the active
  profile. On a mismatch it shows an error dialog and does nothing (moapplication.cpp L381-440).
  So `ModOrganizer.exe -p "<profile>" refresh` guards the profile, but `-i` **cannot tell two
  portable instances apart**.
- **If no MO2 is running, `refresh` launches the full GUI** and refreshes after startup, because
  `RefreshCommand::runPostOrganizer` returns `{}` and `main` goes on to `app.run()`
  (main.cpp L120-125). **A tool must check that MO2 is running before calling it.**
- `--multiple` lets several primaries run, which is "unsupported and can create all sorts of weird
  problems". A forwarded message then reaches only the process that owns the pipe
  (commandline.cpp `more()`).

### Detecting that MO2 is running for a given portable instance
- **MO2 creates no run-lock file in the instance folder.**
  - `portable.txt` (`AppConfig::portableLockFileName`) only stops the user switching instances.
  - A portable instance is recognised by `ModOrganizer.ini` sitting next to the exe
    (instancemanager.cpp L638-655).
  - src/shared/appconfig.inc L15, L25.
- **Reliable check: enumerate processes named `ModOrganizer.exe` and compare the full image path**
  with `<instanceDir>\ModOrganizer.exe`. A portable instance's directory is the exe's directory
  (`portablePath()` is `applicationDirPath()`). In Node, use `Get-CimInstance Win32_Process`
  ExecutablePath, or `QueryFullProcessImageNameW`.
- A cheap "is any primary running" check is whether the named pipe
  `\\.\pipe\mo-43d1a3ad-eeb0-4818-97c9-eda5216c29b5` exists. Qt maps a bare `QLocalServer` name to
  a `\\.\pipe\` path (https://doc.qt.io/qt-6/qlocalserver.html). The exact pipe name is
  **UNVERIFIED**: MO2 was not running on this machine to check.
- **Caveat: the process path does not prove which profile is active.** The best hint is
  `[General] selected_profile` in `ModOrganizer.ini`, written by `GameSettings::setSelectedProfileName`
  (settings.cpp L704-707) and stored from `storeSettings()`. Whether it is flushed at once when the
  user switches profile is **UNVERIFIED**. Pass `-p <profile>` to `refresh` so a mismatch is refused.
