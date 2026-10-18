# Move Portal: manager-only NetSuite writes at the dock (2026-10-17)

This amends `2026-10-16-move-portal-drop-trailer-docs-design.md`. It covers scan-built (drop-trailer) trucks only. The office-IF flow is untouched.

## Why
On 2026-10-17 in the sandbox, the floor login pressed **Save seal** on Truck 1 (TO8723 · IF53840), and NetSuite refused it with:
"You must have 'Transactions -> Fulfill Sales Orders' view permission to view sales order fulfillments."

The floor login (deploy 2, Execute As Current Role) has no IF or TO permissions, and Jack wants to keep it that way. **Only a manager writes to NetSuite.** The floor login is only for floor screens. It doesn't log in as a NetSuite user who could write.

## Jack's rulings (2026-10-17)
1. **The seal goes in only on the Shipments tab, at the dock.** It is never entered while finishing the load or at Send for docs.
2. **Approve docs** writes the TO (status B) and the IF as **Packed (B)**. It used to write Picked (A).
3. **The load is locked once the docs are approved (option 1).** The floor can't scan pallets on or off at the dock.
   - To change the load, a manager presses **↩ Send back to Load out**.
   - The floor fixes the load, verifies, and presses Send for docs.
   - The manager presses **Approve** again. That writes **only the difference** onto the same TO and IF.
   - Option 2 (send each dock change to the manager) was considered and rejected.
4. **Floor Picked up** sends the truck to the manager. The **manager's Confirm shipped** stamps each IF Shipped (C) with the seal.

## Flow

1. **Ready for docs.** The floor presses **Send for docs**. No seal is asked for.
2. **Manager Approve docs.**
   - Stock check, then `to_create` B and `if_create ship:'packed'`.
   - The truck is now **at dock** and its load is locked.
3. **At dock**, the floor can:
   - **Save seal.** Portal only.
   - Tap **🚛 Picked up**. The seal is required. The truck moves to `pickup_pending`.
4. **Manager, from `pickup_pending`:**
   - **✅ Confirm shipped:** each IF gets `if_stamp`, the pallets go in transit, and the truck departs.
   - **↩ Send back:** the truck goes back to the dock with a note.
5. **To change the load,** a manager presses **↩ Send back to Load out**. It works from at dock or `pickup_pending`, as long as no stamp has landed.
   - The truck goes to `loading` and its docs stay parked:
     - `toId`, `ifId`, `docLines` and `alloc` stay on the truck.
     - `depart` moves to `docsDepart`.
   - The floor loads and verifies again, then presses Send for docs.
   - The manager presses Approve. `reApproveDocs` computes the difference between the load and `docLines` and writes it with `writeDocsDelta`, which is the same op-by-op write, undo and out-of-sync code the dock edits used.
     - The stock check covers increases only.
     - An add-on SKU that would drop to 0 is refused, and the office removes it.
     - If NetSuite refuses, nothing changes and the truck waits in `ship_pending` with the error.
     - If the undo also fails, the truck goes to the dock with **Docs out of sync**, and the manager presses Retry.
   - The truck parks at the dock again with its Truck # and day kept.

## Details
- New truck status `pickup_pending`.
  - It is trailer-busy and shows as open on Shipments.
  - Its Dashboard stage is "Waiting for ship confirm".
  - Its pallets are locked the same way as `at_dock`.
- `if_create ship:'packed'` sets shipstatus B and finds the IF again by token. Dock add-on IFs are Packed too.
- `if_stamp` takes an IF in A or B and sets it to C. Trucks approved before this change still have Picked IFs, and they still ship.
- Dock edits (`truck_scan` and `truck_remove` at the dock) are **manager only on the server**. There is no manager screen for them, so their only use is the existing dock write code and its tests.
- `dock_seal` writes no `if_seal`. It still refuses a seal used on another truck, and it refuses while a pickup is half done.
- `picked_up_force` works at `at_dock` and at `pickup_pending`.
- **Approvals** gets three changes:
  - A new **Picked up · confirm shipped** section, with Confirm shipped, Send back, View load, and Mark picked up without NetSuite.
  - A new **At the dock** list at the bottom, with Send back to Load out, View load, and force.
  - The ship-confirm card for a re-approve says "Approve updates TO… + IF… with only the change".
- The manager's **View load** pop-up shows per-SKU weight and per-pallet estimated weight. Pallet records have no dimensions. For an at-dock trailer, the pop-up also has Send back to Load out.
- **Floor screens:**
  - The at-dock card shows "🔒 Load locked" and any send-back note.
  - The truck screen has no scan box and no ✕ at the dock.
  - A new "Picked up · waiting for manager" list.
