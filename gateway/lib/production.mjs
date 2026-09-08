import { readConfig, createVerifier } from './auth.mjs';
import { createGateway, metadataResponse } from './gateway.mjs';
import { configuredStore } from './postgres-store.mjs';

const config = readConfig();
export const handleMcp = createGateway({ config, verify: config ? createVerifier(config) : null, store: config ? configuredStore() : null });
export const handleMetadata = request => metadataResponse(request, config);
