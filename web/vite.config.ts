import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Inline all JS/CSS into a single index.html so Photino can load it over file://
// without the module-script CORS errors that a normal multi-file Vite build hits.
// Output goes straight into the App's wwwroot, which the .csproj copies to bin output.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../src/Gitxt.App/wwwroot",
    emptyOutDir: true,
    target: "es2022",
  },
});
