/**
 * Commit format: <type>(HEY-<n>): <description>
 * e.g. feat(HEY-12): add frame gallery to the design step
 * The Jira key in the scope links the commit to the ticket in Jira's development panel.
 */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-empty": [2, "never"],
    "scope-case": [0],
    "header-max-length": [2, "always", 100],
    "subject-case": [0],
    "scope-jira-key": [2, "always"],
  },
  plugins: [
    {
      rules: {
        "scope-jira-key": ({ scope }) => [/^HEY-\d+$/.test(scope ?? ""), "scope must be a Jira key, e.g. feat(HEY-12): …"],
      },
    },
  ],
  ignores: [(message) => message.startsWith("Merge ")],
};

export default config;
