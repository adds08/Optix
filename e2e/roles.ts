/*
  The seeded accounts, and what each is here to prove.

  Before STI-304 there were three accounts — `owner`, `equipment_admin` and
  `warehouse` — and all three see everything. Every journey this product had
  ever been exercised on was therefore driven by an account that could not be
  refused anything, which is why no permission denial had ever actually been
  observed. There is now one account per role, and this list is what makes the
  browser suite able to tell them apart.

  `expectedTier` is the visibility tier the STI-302 ladder should resolve for
  that account. It is asserted rather than assumed: a role whose tier silently
  widened would show the right screens with the wrong rows on them, which no
  screenshot catches.
*/
export type Role = {
  key: string;
  email: string;
  /* Where the app should put them after login. Field roles are redirected off
     /home by the shell; getting this wrong is itself a regression. */
  landsOn: string;
  /*
    Routes the sidebar must offer, and must not.

    Asserted as HREFS rather than link text on purpose. The label is copy —
    "Users" became "User Accounts" during Phase 3 and would have broken every
    one of these for no reason — while the route is the contract the permission
    actually gates. A test that fails when somebody improves a word teaches
    people to stop reading it.
  */
  expectsRoutes: string[];
  /* The half that catches a widening. A missing link is a bug somebody
     reports; an extra one is a permission leak nobody notices until it is
     used. */
  forbidsRoutes: string[];
};

export const PASSWORD = "stinventory-demo";

export const ROLES: Role[] = [
  {
    key: "owner",
    email: "owner@stinventory.local",
    landsOn: "/home",
    expectsRoutes: ["/home", "/tools", "/admin/roles", "/desk"],
    forbidsRoutes: [],
  },
  {
    key: "warehouse",
    email: "warehouse@stinventory.local",
    landsOn: "/home",
    expectsRoutes: ["/home", "/jobsites", "/custody", "/desk"],
    /* The yard desk runs custody and does NOT administer accounts — it lacks
       `config.manage`. If these appear, somebody widened the desk. */
    forbidsRoutes: ["/admin/roles", "/settings"],
  },
  {
    key: "foreman",
    email: "foreman@stinventory.local",
    /* Field roles are redirected away from the dashboard by the shell. */
    landsOn: "/my-tools",
    expectsRoutes: ["/my-tools", "/desk", "/chat"],
    forbidsRoutes: ["/tools", "/reports", "/custody"],
  },
  {
    key: "mechanic",
    email: "mechanic@stinventory.local",
    landsOn: "/my-tools",
    /* A mechanic gets the FIELD layout — added to FIELD_ROLES by STI-304,
       because the desk's twelve-item navigation is the wrong shelf for
       somebody who works out of the shop. */
    expectsRoutes: ["/my-tools", "/desk"],
    forbidsRoutes: ["/tools", "/custody"],
  },
  {
    key: "hr",
    email: "hr@stinventory.local",
    landsOn: "/home",
    /* HR reads people, deliberately not tools. */
    expectsRoutes: ["/people"],
    forbidsRoutes: ["/tools", "/custody", "/jobsites", "/admin/roles"],
  },
];

export const authFile = (key: string) => `.auth/${key}.json`;
