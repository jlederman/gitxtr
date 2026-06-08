# gitxtr dev workflow. Run the two dev targets in separate terminals:
#   terminal 1:  make web
#   terminal 2:  make app REPO=/path/to/repo
# Requires Node/npm (nvm) and the .NET 10 SDK on PATH.

APP  := src/Gitxtr.Host
REPO ?=

# Local installer build (current OS, unsigned). Override as: make pack RID=win-x64 VERSION=1.2.3
RID     ?= osx-arm64
VERSION ?= 0.0.1

.PHONY: help web app run build test format install clean pack publish-win

help:
	@echo "gitxtr make targets:"
	@echo "  make web                # terminal 1: Vite dev server (frontend HMR)"
	@echo "  make app [REPO=/path]   # terminal 2: backend w/ C# hot-reload, UI served from the dev server"
	@echo "  make run [REPO=/path]   # production run (built bundle, no dev server)"
	@echo "  make build              # dotnet build (also builds the web bundle)"
	@echo "  make test               # run the domain tests"
	@echo "  make format             # dotnet format (C#) + prettier (web)"
	@echo "  make install            # npm install + dotnet restore"
	@echo "  make pack [RID= VERSION=] # local unsigned installer via Velopack → ./release"
	@echo "  make publish-win [RID=win-arm64] # cross-compile Windows build → ./publish (copy to VM for testing)"
	@echo "  make clean              # dotnet clean"

# Terminal 1 — frontend: Vite dev server with hot module reloading on :5173.
web:
	cd web && npm run dev

# Terminal 2 — backend: dotnet watch (rebuilds/restarts on C# changes), with the window pointed
# at the Vite dev server so web edits hot-reload. Pass REPO=/path to open a repo on launch.
app:
	GITXTR_DEV_URL=http://localhost:5173 dotnet watch --project $(APP) run -- $(REPO)

# Production-style run: loads the bundled UI from wwwroot (no dev server / HMR).
run:
	dotnet run --project $(APP) -- $(REPO)

build:
	dotnet build $(APP)

test:
	dotnet test tests/Gitxtr.Domain.Tests

# Format the whole codebase: C# via dotnet format (.editorconfig), web via prettier (.prettierrc).
format:
	dotnet format whitespace gitxtr.slnx
	cd web && npm run format

install:
	cd web && npm install
	dotnet restore

clean:
	dotnet clean

# Self-contained publish + Velopack pack for the current OS (unsigned). Needs the vpk tool:
#   dotnet tool install -g vpk
# vpk does not support cross-OS packaging — always run for the OS you're on.
pack:
	rm -rf publish
	dotnet publish $(APP)/Gitxtr.Host.csproj -c Release -r $(RID) --self-contained true -o publish
	vpk pack -u gitxtr -v $(VERSION) -p publish --packTitle gitxtr -o release

# Cross-compile a Windows build from macOS/Linux for manual VM testing.
# Copy ./publish/ to the Windows VM and run gitxtr.exe directly (no installer).
# For signed installers use the GitHub Actions release workflow instead.
publish-win:
	rm -rf publish
	dotnet publish $(APP)/Gitxtr.Host.csproj -c Release -r $(RID) --self-contained true -o publish
