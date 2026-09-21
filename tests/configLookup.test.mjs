import * as esbuild from "esbuild";
import { createRequire } from "module";
import assert from "assert";

const require = createRequire(import.meta.url);

async function run() {
  const result = await esbuild.build({
    entryPoints: ["src/configLookup.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external: ["obsidian", "yaml"]
  });

  const code = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function("module", "exports", "require", code);
  fn(mod, mod.exports, require);

  const { ConfigLookup, BUILTIN_SHOOTS } = mod.exports;
  const cl = new ConfigLookup("");

  console.log("Running ConfigLookup tests...");

  // Test 1: getShoot with unknown preset name should return undefined
  const unknownShoot = cl.getShoot("pure-moonlit");
  assert.strictEqual(unknownShoot, undefined, "Expected getShoot('pure-moonlit') to be undefined");
  console.log("✓ Test 1: getShoot('pure-moonlit') correctly returns undefined");

  // Test 2: getShoot with valid ID
  const knownShoot = cl.getShoot("bath_georgian");
  assert(knownShoot !== undefined, "Expected getShoot('bath_georgian') to be found");
  assert.strictEqual(knownShoot.id, "bath_georgian");
  console.log("✓ Test 2: getShoot('bath_georgian') found correctly");

  // Test 3: getDefaultShoot
  const def = cl.getDefaultShoot();
  assert(def !== undefined);
  assert.strictEqual(def.id, "bath_georgian");
  console.log("✓ Test 3: getDefaultShoot returns valid shoot");

  console.log("\nAll ConfigLookup tests passed!");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
