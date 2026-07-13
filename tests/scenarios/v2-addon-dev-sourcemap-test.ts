import path from 'path';
import { appScenarios, baseV2Addon } from './scenarios';
import { PreparedApp } from 'scenario-tester';
import QUnit from 'qunit';
import merge from 'lodash/merge';
import { readFileSync } from 'fs';
import { assertTemplateVariableMapsToSource } from './helpers/source-maps';

const { module: Qmodule, test } = QUnit;

appScenarios
  .only('canary')
  .map('v2-addon-dev-sourcemap', async project => {
    let addon = baseV2Addon();
    addon.pkg.name = 'v2-addon';
    addon.pkg.files = ['dist'];
    addon.pkg.exports = {
      './*': './dist/*.js',
      './addon-main.js': './addon-main.js',
      './package.json': './package.json',
    };
    addon.pkg.scripts = {
      build: 'node ./node_modules/rollup/dist/bin/rollup -c ./rollup.config.mjs',
    };

    merge(addon.files, {
      'babel.config.json': `
        {
          "plugins": [
            "@babel/plugin-transform-typescript",
            ["babel-plugin-ember-template-compilation", {
              targetFormat: 'hbs',
            }],
            ["module:decorator-transforms", {
              runtime: { import: 'decorator-transforms/runtime-esm' }
            }]
          ]
        }
      `,
      'rollup.config.mjs': `
        import { babel } from '@rollup/plugin-babel';
        import { Addon } from '@embroider/addon-dev/rollup';

        const addon = new Addon({
          srcDir: 'src',
          destDir: 'dist',
        });

        export default {
          output: addon.output(),

          plugins: [
            addon.publicEntrypoints(['components/**/*.js']),

            addon.dependencies(),

            babel({ babelHelpers: 'bundled', extensions: ['.js', '.hbs', '.gjs', '.gts', '.ts'] }),

            addon.gjs(),
            addon.hbs(),

            addon.clean(),
          ],
        };
      `,
      src: {
        components: {
          // A .gjs component. \`gjsScopedValue\` is a module-scoped binding that is
          // referenced from inside the template, so it becomes an entry in the
          // compiled \`scope()\` thunk.
          'gjs-demo.gjs': `import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

const gjsScopedValue = 'gjs-scoped-value';

export default class GjsDemo extends Component {
  @tracked gjsTrackedValue = 'gjs-tracked-value';

  <template>
    <span data-test-gjs>{{gjsScopedValue}} {{this.gjsTrackedValue}}</span>
  </template>
}
`,
          // The same idea, but authored in TypeScript so we also exercise the
          // .gts pipeline (content-tag -> transform-typescript -> template
          // compilation -> rollup) and prove the map survives type-stripping.
          'gts-demo.gts': `import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

interface GtsDemoSignature {
  Args: {
    name: string;
  };
}

const gtsScopedValue: string = 'gts-scoped-value';

export default class GtsDemo extends Component<GtsDemoSignature> {
  @tracked gtsTrackedValue: string = 'gts-tracked-value';

  <template>
    <span data-test-gts>{{gtsScopedValue}} {{@name}} {{this.gtsTrackedValue}}</span>
  </template>
}
`,
        },
      },
    });

    addon.linkDependency('@embroider/addon-shim', { baseDir: __dirname });
    addon.linkDependency('@embroider/addon-dev', { baseDir: __dirname });
    addon.linkDependency('babel-plugin-ember-template-compilation', { baseDir: __dirname });
    addon.linkDevDependency('@babel/core', { baseDir: __dirname });
    addon.linkDevDependency('@babel/plugin-transform-typescript', { baseDir: __dirname });
    // a real dependency (not dev) so `addon.dependencies()` externalizes the
    // emitted `decorator-transforms/runtime` import instead of trying to bundle it
    addon.linkDependency('decorator-transforms', { baseDir: __dirname });
    addon.linkDevDependency('@rollup/plugin-babel', { baseDir: __dirname });
    addon.linkDevDependency('rollup', { baseDir: __dirname });

    project.addDevDependency(addon);
  })
  .forEachScenario(scenario => {
    Qmodule(scenario.name, function (hooks) {
      let app: PreparedApp;
      let addonDir: string;

      hooks.before(async () => {
        app = await scenario.prepare();
        let result = await inDependency(app, 'v2-addon').execute('pnpm build');
        if (result.exitCode !== 0) {
          throw new Error(result.output);
        }
        addonDir = inDependency(app, 'v2-addon').dir;
      });

      test('gjs template-scoped variable maps back to its original source', function (assert) {
        assertTemplateVariableMapsToSource(assert, {
          rawMap: readMap(addonDir, 'dist/components/gjs-demo.js.map'),
          originalFile: 'gjs-demo.gjs',
          variable: 'gjsScopedValue',
          label: 'gjs-demo.js.map',
        });
      });

      test('gts template-scoped variable maps back to its original source', function (assert) {
        assertTemplateVariableMapsToSource(assert, {
          rawMap: readMap(addonDir, 'dist/components/gts-demo.js.map'),
          originalFile: 'gts-demo.gts',
          variable: 'gtsScopedValue',
          label: 'gts-demo.js.map',
        });
      });
    });
  });

function readMap(addonDir: string, distMapFile: string): unknown {
  return JSON.parse(readFileSync(path.join(addonDir, distMapFile), 'utf8'));
}

// https://github.com/ef4/scenario-tester/issues/5
function inDependency(app: PreparedApp, dependencyName: string): PreparedApp {
  return new PreparedApp(path.dirname(require.resolve(`${dependencyName}/package.json`, { paths: [app.dir] })));
}
