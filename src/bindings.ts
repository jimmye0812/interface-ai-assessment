// Versioned, reviewed vendor profile. No model-supplied selectors are executed.
export const bindings = {
  memberId: { strategy: "label", value: "Member number", risk: "reversible" },
  search: { strategy: "role", value: "Search", risk: "reversible" },
  details: { strategy: "role", value: "Open member", risk: "reversible" },
  balance: {
    strategy: "css",
    value: 'output[aria-label="Savings balance"]',
    risk: "reversible",
  },
  review: { strategy: "role", value: "Review savings", risk: "reversible" },
  acknowledge: {
    strategy: "role",
    value: "Acknowledge notice",
    risk: "reversible",
  },
  restore: {
    strategy: "role",
    value: "Restore training session",
    risk: "reversible",
  },
  confirm: {
    strategy: "role",
    value: "Confirm transfer",
    risk: "irreversible",
  },
  amount: { strategy: "label", value: "Amount", risk: "irreversible" },
} as const;
