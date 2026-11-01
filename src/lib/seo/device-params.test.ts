// ===== 设备参数口径契约测试（DEF-02）=====
import { describe, expect, it } from "vitest";
import { deviceDisplayLabel, normalizeDeviceParam, toApiDeviceValue, toSerpDevice } from "./device-params";

describe("normalizeDeviceParam", () => {
  it("页面口径与 expand 对外口径都接受", () => {
    expect(normalizeDeviceParam("PC")).toBe("PC");
    expect(normalizeDeviceParam("desktop")).toBe("PC");
    expect(normalizeDeviceParam("移动端")).toBe("移动端");
    expect(normalizeDeviceParam("mobile")).toBe("移动端");
  });

  it("大小写与前后空格不影响结果", () => {
    expect(normalizeDeviceParam("  DESKTOP ")).toBe("PC");
    expect(normalizeDeviceParam("Mobile")).toBe("移动端");
  });

  it("无法识别的值返回 null（由调用方决定 400 或默认）", () => {
    expect(normalizeDeviceParam("")).toBeNull();
    expect(normalizeDeviceParam("tablet")).toBeNull();
    expect(normalizeDeviceParam(null)).toBeNull();
    expect(normalizeDeviceParam(undefined)).toBeNull();
  });
});

describe("toSerpDevice / toApiDeviceValue", () => {
  it("expand 返回 desktop 时，转成 SERP 接口要的 PC", () => {
    expect(toSerpDevice("desktop")).toBe("PC");
    expect(toSerpDevice("mobile")).toBe("移动端");
  });

  it("无法识别时退回 PC（与页面默认一致）", () => {
    expect(toSerpDevice("weird")).toBe("PC");
  });

  it("页面口径转回对外契约", () => {
    expect(toApiDeviceValue("PC")).toBe("desktop");
    expect(toApiDeviceValue("移动端")).toBe("mobile");
  });

  it("展示标签按语言切换", () => {
    expect(deviceDisplayLabel("PC", true)).toBe("PC");
    expect(deviceDisplayLabel("移动端", true)).toBe("移动端");
    expect(deviceDisplayLabel("移动端", false)).toBe("Mobile");
  });
});
