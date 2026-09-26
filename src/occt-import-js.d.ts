declare module "occt-import-js" {
  export type OcctMesh = {
    attributes: {
      position: { array: ArrayLike<number> };
      normal?: { array: ArrayLike<number> };
    };
    index: { array: ArrayLike<number> };
  };

  export type OcctStepResult = {
    success: boolean;
    meshes: OcctMesh[];
  };

  export type OcctInstance = {
    ReadStepFile: (content: Uint8Array, params: { linearUnit?: "millimeter" | "meter" } | null) => OcctStepResult;
  };

  export default function occtimportjs(module?: {
    locateFile?: (file: string) => string;
  }): Promise<OcctInstance>;
}
