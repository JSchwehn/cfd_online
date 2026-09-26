import { describe, expect, it } from "vitest";
import readme from "../README.md?raw";
import workflow from "../.github/workflows/pages.yml?raw";

describe("GitHub Pages", () => {
  it("publishes the production build", () => {
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("path: dist");
    expect(readme).toContain("https://jschwehn.github.io/cfd_online/");
  });
});
