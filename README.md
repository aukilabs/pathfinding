# NavGraph

A pathfinding library with JavaScript/TypeScript bindings and a web-based testbed application.

## Project Structure

- `auki-pathfinding-js/` - TypeScript pathfinding library
- `auki-pathfinding-rs/` - Rust implementation (not covered in this README)
- `test-web-wasm/` - React + Vite web application for testing the pathfinding library

## Prerequisites

- Node.js (v22 or higher)
- npm

## Quick Start


### 2. Build the local pathfinding package

```bash
cd auki-pathfinding-js
npm install 
npm run build 
```

This command will:
- Install dependencies for the TypeScript library
- Build the TypeScript library
- Install dependencies for the test web application

### 3. Run the web application

```bash
cd test-web-wasm
npm install
npm run dev
```

The application will be available at `http://localhost:5173`

## Dependencies

The package uses:
- **earcut** for polygon triangulation
- **recast-navigation-js** for pathfinding algorithms
- **three** for 3d types and mesh building

The testbed uses:
- **React + Vite** for the web testbed
- **Tailwind CSS** for styling