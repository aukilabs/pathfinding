import OBJFile from "obj-file-parser";

type OBJData = {
  models: {
    name: string;
    vertices: { x: number; y: number; z: number }[];
    textureCoords: { u: number; v: number; w: number }[];
    vertexNormals: { x: number; y: number; z: number }[];
    faces: {
      material: string;
      group: string;
      smoothingGroup: number;
      vertices: {
        vertexIndex: number;
        textureCoordsIndex: number;
        vertexNormalIndex: number;
      }[];
    }[];
  }[];
};

export type ParsedOBJModel = {
  name: string;
  positions: number[];
  indices: number[];
};

export function ParseOBJString(data: string) {
  const newdata = data.replaceAll("g ", "o ");
  const output = new OBJFile(newdata).parse() as OBJData;

  let startingIndex = 1;
  const parsedOutput = output.models
    .filter((a) => {
      return a.vertices.length > 0;
    })
    .map((model): ParsedOBJModel => {
      //map vertices
      const vertices = model.vertices.flatMap((v) => [v.x, v.y, v.z]);
      model.vertices.flatMap((v) => [v.x, v.y, v.z]);
      //map indices
      const indices = model.faces.flatMap((f) =>
        f.vertices.map((v) => v.vertexIndex - startingIndex)
      );

      //bump up the indices for the next model
      startingIndex += model.vertices.length;

      return { name: model.name, indices, positions: vertices };
    });
  return parsedOutput;
}
