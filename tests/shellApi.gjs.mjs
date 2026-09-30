import {
    probeShellCapabilities,
    runShellCapabilityGate,
} from '../shellApi.js';
import {makeCompatibleShellApi} from './shellApiFixture.mjs';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const compatible = probeShellCapabilities(makeCompatibleShellApi());
assert(compatible.supported, 'compatible fixture must pass under GJS');
assert(compatible.missing.length === 0, 'compatible fixture has missing capabilities');

const unsupportedApi = makeCompatibleShellApi();
delete unsupportedApi.Main.overview._overview.controls.layout_manager;
let mutationCount = 0;
let fallbackCount = 0;
const result = runShellCapabilityGate(unsupportedApi,
    () => mutationCount++,
    report => {
        fallbackCount++;
        return report;
    });

assert(!result.supported, 'missing layout must fail under GJS');
assert(result.missing.includes('overviewControls.layout_manager'),
    'missing layout must be reported under GJS');
assert(mutationCount === 0, 'unsupported GJS gate invoked mutation callback');
assert(fallbackCount === 1, 'unsupported GJS gate did not invoke one fallback');

print('GJS Shell capability preflight: PASS');
