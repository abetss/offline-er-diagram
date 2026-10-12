import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const homebrewCargo = '/opt/homebrew/opt/rustup/bin/cargo';
const cargo = process.env.DBML_CARGO ?? (existsSync(homebrewCargo) ? homebrewCargo : 'cargo');
const result = spawnSync(cargo, [
  'build', '--manifest-path', join(root, 'parser-wasm/Cargo.toml'),
  '--target', 'wasm32-unknown-unknown', '--release', '--locked',
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: isAbsolute(cargo) ? `${dirname(cargo)}${delimiter}${process.env.PATH ?? ''}` : process.env.PATH,
  },
});
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write('Parser build failed. Check the Cargo error above. This build needs the wasm32-unknown-unknown Rust target.\n');
  process.exit(result.status ?? 1);
}
await mkdir(join(root, 'media'), { recursive: true });
await copyFile(
  join(root, 'parser-wasm/target/wasm32-unknown-unknown/release/dbml_parser_wasm.wasm'),
  join(root, 'media/parser.wasm'),
);
