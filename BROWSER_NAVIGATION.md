# Browser navigation

Main portal views, diary appointment windows and staff client-search/record screens now create same-document browser history. Back and Forward restore navigation without modifying authentication, appointments, payments or database records. Staff searches keep their entered criteria and results on return. Client records open on Appointments by default; patch-test checkout retains its Patch Tests shortcut.

History snapshots are held in memory and scoped to the current portal/login. Only an opaque entry ID and scope are written to history.state; no PIN, password or client details are written into it. Logging out or changing identity clears snapshots so Back cannot restore an earlier user's screens or login. Supabase authentication/recovery URL fragments are left for the SDK to consume.

URLs have readable view fragments such as `#my-vouchers` and `#staff-workspace/search`. These are navigation labels rather than standalone deep links. Refresh starts from the appropriate authenticated home; the previous in-memory navigation journey is not restored after a full reload.

Client, staff and accountant portals retain their separate authentication storage. Once Back reaches the beginning of this portal's navigation, ordinary browser navigation may return to a previously visited URL. If that other portal is still signed in, its own saved account remains signed in; Back does not transfer the current staff identity into the client portal.

No Supabase migration or Edge Function deployment is required for this change. Refresh after GitHub Pages deploys.
