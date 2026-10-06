# School example — operation permission policies, end to end

A small, invented school, split across three realms so that a policy, not the
realm permissions, decides what each member of staff can reach:

| Realm              | Holds                                                       | Who can read it                      |
| ------------------ | ----------------------------------------------------------- | ------------------------------------ |
| `school-code`      | the card definitions, and the staff portal                  | every signed-in user (`users: read`) |
| `school-org`       | the staff roster, and the Education realm's `RealmPolicy`   | the IT admin                         |
| `school-education` | classrooms, service-plan schedules and sessions, activities | the IT admin                         |

Teachers and service providers hold **no** permission on `school-org` or
`school-education`. Everything they can do there, they can do because the
policy at `school-org/policies/education.json` grants it:

```json
{
  "targetType": { "module": "../../school-code/classroom", "name": "Classroom" },
  "grants": [
    {
      "operation": "read",
      "where": "(.teacherIds | any(. == actor())) or (.leadTeacherIds | any(. == actor()))"
    },
    { "operation": "appendActivity", "where": ".teacherIds | any(. == actor())" }
  ]
},
{
  "targetType": {
    "module": "../../school-code/service-plan-schedule",
    "name": "ServicePlanSchedule"
  },
  "grants": [
    { "operation": "read", "where": ".providerId == actor()" },
    { "operation": "listMySchedules", "where": ".providerId == actor()" }
  ]
}
```

Those two rules are the whole of "instructors get access to the classrooms they
teach and the schedules they provide". No grant names a person: each compares
the caller, `actor()`, with ids stored on the card being judged. Changing who
teaches a classroom is a change to the classroom, never to the policy.

**No staff member, student or school here is real.**

## What each grant means

- **`read` on `Classroom`** — a teacher or lead teacher reads the classroom.
  The predicate runs against the classroom's stored source, so a roster change
  takes effect on the next request. Membership is spelled
  `.list | any(. == actor())`, never `contains`, which matches substrings and
  is refused in a policy. The two membership tests are parenthesized because
  `|` binds looser than `or`.
- **`appendActivity` on `Classroom`** — a teacher (not a lead teacher) logs an
  activity. `appendActivity` is a named `create` declared on `Classroom`
  (`school-code/classroom.gts`); it writes the caller as `author` and the
  classroom as `classroom` whatever the caller sends. The policy decides
  _whether_; the operation decides _what_. The teacher cannot read the realm,
  so the realm chooses the new activity's id.
- **`read` on `ServicePlanSchedule`** — a provider reads the schedules they
  provide.
- **`listMySchedules` on `ServicePlanSchedule`** — a provider lists them. It is
  a saved search, and the realm runs its own copy of the declaration with the
  grant's filter composed in: one SQL query, correctly paged. The `read` grant
  contributes nothing to a search, and a `read` grant alone does not let anyone
  enumerate a type.

Everything else is refused. A teacher asking for a classroom they do not teach
gets a 404 identical to the answer for a classroom that does not exist, because
they cannot read the realm. Someone who can read the realm gets a 403 instead.
An anonymous caller gets a 401 before the realm looks the target up.

## Why the cards keep ids beside their links

A classroom links to its teachers' roster cards (`teachers`) and also stores
their Matrix ids (`teacherIds`). The policy reads the ids. `actor()` is the
caller's Matrix user id as a string, and a predicate reads the stored card,
where a link is only a URL, so a predicate cannot follow `teachers` to compare
the caller with the roster. Until a policy can resolve the caller to a card,
any realm whose roster is links needs a mirror like this.

The mirror is authorization-bearing, and nothing keeps it in step on its own.
When the roster changes, the IT admin opens each classroom and schedule and
presses **Sync ids from the roster**, which writes the ids with an ordinary
`update`. The page warns whenever the two disagree.

It is also why the policy pairs these grants with `appendActivity` and never
with a raw `update`. A write is authorized against the card as it stands before
the write, so a teacher granted `update` because they appear in `teacherIds`
could rewrite `teacherIds` in the same request. `appendActivity` cannot reach
`teacherIds` at all.

## Where the code lives, and why

The card definitions are in `school-code`, which everyone reads. A teacher's
browser has to load `Classroom` to render a classroom, and module source is
never reachable through a policy grant: a realm serves its modules and its file
tree only to callers who may read it. So the definitions live apart from the
data they describe. Code mode on `school-education` shows a teacher nothing,
and the host does not offer it to them.

## Setting it up in an environment

Everything that differs between environments is configuration held in cards:
which Boxel accounts the staff sign in with (the roster), and where the Org
realm is (one line in the Education realm's settings). The files in this
package are the same everywhere.

You need one account that owns the three realms (the IT admin), and one account
for each member of staff you want to act as:

| Roster card                     | Role                        | Demonstrates                                                    |
| ------------------------------- | --------------------------- | --------------------------------------------------------------- |
| `school-org/StaffMember/alice`  | Grade 3 teacher             | reads Room 204 and logs activities there; reads Room 205 (lead) |
| `school-org/StaffMember/ben`    | Grade 4 teacher, a provider | the colleague; lists the one schedule he provides               |
| `school-org/StaffMember/carmen` | Speech-language pathologist | lists and reads her two schedules                               |

An optional fifth account, given read on `school-education` only, shows the 403
a realm reader gets where a teacher gets a 404.

1. **Create the three realms** as the IT admin, side by side under the same
   account, with exactly these names, so the relative links between them
   resolve:

   ```sh
   boxel realm create school-code "School Code"
   boxel realm create school-org "School Org"
   boxel realm create school-education "School Education"
   ```

2. **Push the files** into each one. `boxel realm push` writes its own
   bookkeeping (`.boxel-sync.json`, `.boxel-history/`) into the directory it
   pushes, so push from a copy rather than from this package:

   ```sh
   mkdir -p /tmp/school
   cp -r packages/school-example-realm/school-* /tmp/school/
   boxel realm push /tmp/school/school-code <realm-server>/<owner>/school-code/
   boxel realm push /tmp/school/school-org <realm-server>/<owner>/school-org/
   boxel realm push /tmp/school/school-education <realm-server>/<owner>/school-education/
   ```

3. **Let every signed-in user read `school-code`.** A realm's permissions take
   a `users` entry for every signed-in user (`*` would open it to anonymous
   visitors too, which the example doesn't need). From the browser's console
   while signed in as the IT admin, with `realm` set to the `school-code` URL:

   ```js
   let token = JSON.parse(localStorage.getItem('boxel-session'))[realm];
   await fetch(`${realm}_permissions`, {
     method: 'PATCH',
     headers: {
       'Content-Type': 'application/vnd.api+json',
       Authorization: token,
     },
     body: JSON.stringify({
       data: {
         type: 'permissions',
         id: realm,
         attributes: { permissions: { users: ['read'] } },
       },
     }),
   });
   ```

4. **Fill in the roster.** Open each `StaffMember` card in `school-org`, switch
   it to edit, and set **Matrix User Id** to the account that person signs in
   with in this environment, e.g. `@school-alice:stack.cards`. This is the only
   place a username is written. Pushing `school-org` again writes the shipped roster cards back
   over these edits, so push before configuring, or fill the ids in again
   after.

5. **Point the Education realm at its policy.** Open `school-education`'s
   settings card (`<realm-server>/<owner>/school-education/realm`), switch it to
   edit, press **Link Realm Policy** and choose **Education realm policy** from
   `school-org`. The settings card then shows the policy **In force**. The
   pointer it stores is the policy card's absolute URL; until it is set the
   realm has no policy and answers every staff member on its realm permissions
   alone, which grant them nothing.

6. **Sync the mirrors.** As the IT admin, open each classroom in
   `school-education/classrooms/` and each schedule in
   `school-education/schedules/`, and press **Sync ids from the roster**. The
   button waits until every linked roster card has loaded, so a sync never
   writes a partial list.

7. **Optional:** give the fifth account read on `school-education` the same way
   as step 3, with `{ "<their Matrix id>": ["read"] }`.

Then sign in as each member of staff and follow a link into the Education realm,
or open `school-code/SchoolPortal/portal` for a provider's schedules.

## Things to know before copying this

- **Search is only as fresh as the index.** Removing a provider from a schedule
  refuses their direct read on the next request, but `listMySchedules` can keep
  listing the schedule until it is reindexed.
- **A granted read carries what the card links to, unless the card says
  otherwise.** By default a teacher who reads a classroom would also receive
  every roster card it links to, and the policy grants nobody the roster. So
  `Classroom` and `ServicePlanSchedule` declare their `read` (and
  `listMySchedules`) with `links: 'ids'`: the response names each linked card
  and carries none of them, and a viewer's host fetches each link on its own
  request, which the roster refuses a teacher. The policy compiler warns
  (`grant-reaches-ungranted-type`) when a grant would carry a type no rule
  grants.
- **Do not filter on the list a grant reads.** A search for "classrooms whose
  `teacherIds` hold a colleague" by a teacher whose grant reads `teacherIds`
  returns nothing: the grant's condition and the search's must hold for one
  list element at once.
- **The IT admin's view of the policy.** Anyone who reads both `school-org` and
  `school-education` can ask the policy card to explain a decision — which
  grants matched a given actor, target and operation, and what each predicate
  said. Open `school-org/policies/education` and use **Explain a decision**.
