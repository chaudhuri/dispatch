import { describe, expect, test } from "@jest/globals";
import { FileBacked } from "../src-ts/initial-vals";

describe("initial-vals", () => {
    test("config dir exists", () => {
        expect(FileBacked.configDir).toBeTruthy();
        expect(FileBacked.configDir.endsWith("dispatch")).toBeTruthy();
    });
});
