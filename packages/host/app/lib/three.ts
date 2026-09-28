// The host's three.js surface, served to card code through the
// `@cardstack/boxel-host/lib/three-loader` doorway. Vendoring the engine here
// — rather than fetching a CDN build inside the capture render — keeps realm
// indexing off the public network: the 3D poster capture runs on prerender
// infrastructure, where CDN reachability would otherwise be a standing
// availability dependency of every realm that holds a 3D model.
//
// This module is imported only through the loader's lazy `import()`, so
// three.js stays out of the host's initial chunk graph; the bundle chunk
// loads the first time a consumer (in practice, the 3D families'
// capture-only component) asks for it. The version is pinned to the build
// the live orbit viewer loads from its CDN, so a capture and the viewer
// agree on framing and shading.
import * as THREE from 'three';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export { THREE, GLTFLoader, STLLoader, ThreeMFLoader };
