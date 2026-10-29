// The hub (#208, S2 of #168): everything a host of the hub needs, from one place, loading nothing of the engine and
// starting nothing at load. Two ways it is built, one source:
// - inside the engine, as the folder src/hub, by the engine's own build. So the engine's build watcher, renew, the
//   keeper's good build, try, ship and a teammate's `git pull` all carry the hub with no step of their own, and the
//   engine needs no package of its own to install (the hub's one dependency, ws, is the engine's too).
// - alone, as the package sol/hub (@sol/hub, its src a link to this folder), for the cloud box (sol/cloud, S3): its own
//   package.json, lockfile and tsconfig, built to sol/hub/dist, with no engine around it.
// engine/src/team/relay.ts wires it to the engine's settings and gh. Nothing here may import from outside this folder
// but node's own modules and ws (sol/hub/test/package.test.ts).
export * from "./hub-types.js";
export * from "./relay-hub.js";
export * from "./registry.js";
export * from "./spool.js";
export * from "./proof.js";
export * from "./github.js";
export * from "./load.js";
export * from "./join.js";
