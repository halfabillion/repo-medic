import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "repo",
  resourceTable: schema.repos,
  sharesTable: schema.repoShares,
  displayName: "Repository",
  titleColumn: "name",
  getResourcePath: (repo) => `/repos/${repo.id}`,
  getDb,
});
