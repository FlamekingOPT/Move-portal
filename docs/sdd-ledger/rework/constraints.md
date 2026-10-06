## Global Constraints

- **Tests:** run `node --test "move_portal/test/*.test.js"` from the repo root `G:\My Drive\Move-portal`. The quoted glob is required on Windows. The suite starts at 203/203 and must end green with pristine output.
- **Branch:** `feat/v3-verification`. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Don't push until the controller says to.
- **Truck statuses:** `loading · needs_fix · ready · ship_pending · departing · departed · receiving · approving · received`.
- **Open (scannable/editable) trucks:** `loading · needs_fix · ready`, with no claim and no depart. `ship_pending` is locked.
- **Pallet changes:** any pallet change on `ready` sets the truck back to `loading` (as today). Other-item edits also set `ready` back to `loading`.
- **Truck label:** `'Trailer ' + trailer` before departure. After departure it is `Truck N · MM/DD`, as today.
- **Trailers:** a trailer is unique among trucks not yet departed (statuses `loading`/`needs_fix`/`ready`/`ship_pending`). Compare after trimming and upper-casing.
- **Short-pick note:** free text, required whenever a manual Verify produces any `if_short` and the truck has no saved note. The 30 s recheck (`trucks_recheck`) never needs one.
- **Other items:** `{id, desc (1–80 chars), qty (whole ≥ 1), by, at}`. Verify ignores them. They're carried into `data.depart.otherItems`.
- **Ship mark and confirm:**
  - `ship_mark` (floor) works only from `ready` and needs a seal. Seal reuse is refused (`sealUsed`, by digits).
  - `ship_confirm` and `ship_sendback` are manager-only.
  - Departure time = `shipReq.at`. Truck # is assigned at confirm.
- **Lesson:** `data.updateLoad(L, patch)` merges `patch.data` over the copy passed in. Always re-read with `data.getLoad(id)` right before an update, and re-check status and claim.
- **Never kill node processes by image name.** Jack's preview runs on :8765, and a demo may run on :8798. Smoke-test on :8799 with `--store` set to a temp file, and stop only your own PID.

