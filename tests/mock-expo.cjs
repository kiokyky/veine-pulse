const nodeCrypto = require('node:crypto');
const Module = require('node:module');

const secureStore = new Map();
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === 'react-native') {
    return { Platform: { OS: 'ios' } };
  }
  if (request === 'expo-crypto') {
    return {
      getRandomBytes: (len) => new Uint8Array(nodeCrypto.randomBytes(len)),
    };
  }
  if (request === 'expo-secure-store') {
    return {
      setItemAsync: async (k, v) => {
        secureStore.set(k, v);
      },
      getItemAsync: async (k) => secureStore.get(k) ?? null,
      deleteItemAsync: async (k) => {
        secureStore.delete(k);
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

