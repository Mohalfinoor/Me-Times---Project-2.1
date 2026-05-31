# Security Specification for Chronos Task Manager

## Data Invariants
1. **Task Ownership**: Every task must belong to a user (`ownerUid`) or a group (`groupId`).
2. **Group Access**: Access to group tasks is strictly limited to verified members of the group.
3. **Sharing Integrity**: Sharing requests can only be accepted or declined by the intended recipient (email match).
4. **State Isolation**: Personal progress (`UserTaskState`) for shared tasks is visible and editable only by the individual user.
5. **Immutable Identity**: Once created, the `ownerUid` of a task or `creatorUid` of a group cannot be changed.

## The "Dirty Dozen" Payloads (Red Team Tests)

| # | Attack Vector | Payload snippet | Expected Result |
|---|---|---|---|
| 1 | Identity Spoofing | `create task { ownerUid: "OTHER_UID" }` | PERMISSION_DENIED |
| 2 | State Shortcutting | `update sharingRequest { status: "accepted" }` (as sender) | PERMISSION_DENIED |
| 3 | Resource Poisoning | `create group { name: "A".repeat(1000) }` | PERMISSION_DENIED |
| 4 | Unauthorized List Read | `get /tasks (no where clause)` | PERMISSION_DENIED |
| 5 | Ghost Field Injection | `update task { isVerified: true }` | PERMISSION_DENIED |
| 6 | Collaborator Escalation| `update task { collaborators: ["MY_UID"] }` (not invited) | PERMISSION_DENIED |
| 7 | Email Spoofing | `get /sharingRequests/REQS_FOR_OTHER_EMAIL` | PERMISSION_DENIED |
| 8 | Orphaned State | `create userTaskState { taskId: "NON_EXISTENT" }` | PERMISSION_DENIED |
| 9 | Admin Escalation | `update group { admins: ["MY_UID"] }` (as member) | PERMISSION_DENIED |
| 10 | PII Leak | `get /users/OTHER_UID/friends` | PERMISSION_DENIED |
| 11 | Timestamp Fraud | `create task { createdAt: "2099-01-01..." }` | PERMISSION_DENIED |
| 12 | ID Poisoning | `get /tasks/VERY_LONG_STRING_OVER_128_CHARS` | PERMISSION_DENIED |

## Test Runner logic
The accompanying `firestore.rules.test.ts` will implement these scenarios using the Firebase Rules Unit Testing library.
