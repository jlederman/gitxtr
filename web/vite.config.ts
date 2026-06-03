import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Build (npm run build / dotnet build): inline all JS/CSS into a single index.html so Photino can
// load it over file:// without module-script CORS errors, and emit to the App's obj/ build dir
// (git-ignored), which the .csproj copies to wwwroot/ in the output — nothing generated in source.
//
// Dev (npm run dev): a normal HMR dev server on :5173. Point Photino at it with GITXT_DEV_URL
// (see Gitxt.App/Program.cs) for live reload while editing web/.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [viteSingleFile()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: "../src/Gitxt.App/obj/webdist",
    emptyOutDir: true,
    target: "es2022",
  },
}));
