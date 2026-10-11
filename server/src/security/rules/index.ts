import type { SecurityRule } from '../types';
import { noBulkDeletes } from './no-bulk-deletes';
import { noChildProcess } from './no-child-process';
import { noCodeEvaluation } from './no-code-evaluation';
import { noDangerousModules } from './no-dangerous-modules';
import { noDeprecatedApis } from './no-deprecated-apis';
import { noDynamicModuleLoading } from './no-dynamic-module-loading';
import { noDynamicPropertyAccess } from './no-dynamic-property-access';
import { noFilesystemAccess } from './no-filesystem-access';
import { noGlobalTampering } from './no-global-tampering';
import { noInfiniteLoops } from './no-infinite-loops';
import { noNativeModules } from './no-native-modules';
import { noNetworkCalls } from './no-network-calls';
import { noObfuscation } from './no-obfuscation';
import { noProcessAccess } from './no-process-access';
import { noPrototypeEscape } from './no-prototype-escape';
import { noRawDatabase } from './no-raw-database';
import { noSelfModification } from './no-self-modification';
import { noSensitiveServices } from './no-sensitive-services';
import { noStrapiInternals } from './no-strapi-internals';

/**
 * The rule registry. To add a rule, create a file next to this one exporting a
 * `SecurityRule` and append it here; the README section is generated from this list
 * (`npm run docs:rules`).
 */
export const rules: SecurityRule[] = [
  // errors: block the save
  noChildProcess,
  noDangerousModules,
  noDynamicModuleLoading,
  noNativeModules,
  noCodeEvaluation,
  noProcessAccess,
  noFilesystemAccess,
  noGlobalTampering,
  noPrototypeEscape,
  noRawDatabase,
  noStrapiInternals,
  noSensitiveServices,
  // warnings: require acknowledgement
  noObfuscation,
  noDynamicPropertyAccess,
  noInfiniteLoops,
  noNetworkCalls,
  noBulkDeletes,
  noSelfModification,
  noDeprecatedApis,
];
