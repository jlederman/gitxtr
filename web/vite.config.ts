import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Inline all JS/CSS into a single index.html so Photino can load it over file://
// without the module-script CORS errors that a normal multi-file Vite build hits.
// Output goes into the App's obj/ build-intermediate dir (already git-ignored); the .csproj
// copies it to wwwroot/ in the build output — so no generated file lives in the source tree.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../src/Gitxt.App/obj/webdist",
    emptyOutDir: true,
    target: "es2022",
  },
});
