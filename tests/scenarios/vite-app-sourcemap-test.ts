import { appScenarios } from './scenarios';
import type { PreparedApp } from 'scenario-tester';
import QUnit from 'qunit';
import { basename, join } from 'path';
import { assertTemplateVariableMapsToSource, findMapForVariable } from './helpers/source-maps';

const { module: Qmodule, test } = QUnit;

appScenarios
  .only('canary')
  .map('vite-app-sourcemap', project => {
    project.mergeFiles({
      'vite.config.mjs': `
        import { defineConfig } from "vite";
        import { extensions, classicEmberSupport, ember } from "@embroider/vite";
        import { babel } from "@rollup/plugin-babel";

        export default defineConfig({
          build: {
            // emit .map files next to the bundle...
            sourcemap: true,
            // ...and keep the output readable so we can locate the template region
            minify: false,
          },
          plugins: [
            classicEmberSupport(),
            ember(),
            babel({
              babelHelpers: "runtime",
              extensions,
            }),
          ],
        });
      `,
      app: {
        components: {
          // `gjsScopedValue` is a module-scoped binding referenced from inside
          // the template, so it becomes an entry in the compiled scope() thunk.
          'gjs-demo.gjs': `import Component from '@glimmer/component';

const gjsScopedValue = 'gjs-scoped-value';

export default class GjsDemo extends Component {
  <template>
    <span data-test-gjs-demo>{{gjsScopedValue}}</span>
  </template>
}
`,
          // Same, authored in TypeScript, to exercise the .gts pipeline through
          // type-stripping.
          'gts-demo.gts': `import Component from '@glimmer/component';

const gtsScopedValue: string = 'gts-scoped-value';

export default class GtsDemo extends Component {
  <template>
    <span data-test-gts-demo>{{gtsScopedValue}}</span>
  </template>
}
`,
        },
        templates: {
          'application.hbs': `<GjsDemo />
<GtsDemo />
{{outlet}}`,
        },
      },
    });
  })
  .forEachScenario(scenario => {
    Qmodule(scenario.name, function (hooks) {
      let app: PreparedApp;
      let distDir: string;

      hooks.before(async () => {
        app = await scenario.prepare();
        let result = await app.execute('pnpm build');
        if (result.exitCode !== 0) {
          throw new Error(result.output);
        }
        distDir = join(app.dir, 'dist');
      });

      test('gjs template-scoped variable maps back to its original source', async function (assert) {
        // the app bundles/hashes output, so we search the emitted chunks' maps
        let found = await findMapForVariable(distDir, 'gjs-demo.gjs', 'gjsScopedValue');
        assert.ok(found, 'a built chunk maps gjsScopedValue back to gjs-demo.gjs');
        if (!found) {
          return;
        }
        assertTemplateVariableMapsToSource(assert, {
          rawMap: found.rawMap,
          originalFile: 'gjs-demo.gjs',
          variable: 'gjsScopedValue',
          label: basename(found.mapFile),
        });
      });

      test('gts template-scoped variable maps back to its original source', async function (assert) {
        let found = await findMapForVariable(distDir, 'gts-demo.gts', 'gtsScopedValue');
        assert.ok(found, 'a built chunk maps gtsScopedValue back to gts-demo.gts');
        if (!found) {
          return;
        }
        assertTemplateVariableMapsToSource(assert, {
          rawMap: found.rawMap,
          originalFile: 'gts-demo.gts',
          variable: 'gtsScopedValue',
          label: basename(found.mapFile),
        });
      });
    });
  });
