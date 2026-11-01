import { describe, expect, it } from "vitest";
import { mapRoomGifts } from "./scout-gifts.js";

const gift = { id: "9876543210123456789", name: "Nexus Rocket", diamondCount: 500, type: 1, image: { urlList: ["https://cdn.example/rocket.png"] } };

describe("Gift Scout room gift mapping", () => {
  it("maps connector gifts into the verified catalog shape", () => {
    const [g] = mapRoomGifts([gift]);
    expect(g).toEqual({
      gift_id: gift.id, name: "Nexus Rocket", diamonds: 500,
      icon_url: "https://cdn.example/rocket.png", gift_type: 1, streakable: true,
      raw: { id: gift.id, name: "Nexus Rocket", diamond_count: 500, image: { url_list: ["https://cdn.example/rocket.png"] }, type: 1 },
    });
  });
  it("keeps exact string gift IDs beyond safe numeric precision", () => {
    expect(mapRoomGifts([gift])[0].gift_id).toBe("9876543210123456789");
  });
  it("drops gifts without a valid id, name or diamond count", () => {
    expect(mapRoomGifts([{ id: "abc", name: "X", diamondCount: 1 }, { id: "123", name: "", diamondCount: 1 }, { id: "123", name: "X", diamondCount: -1 }, { id: "123", name: "X" }])).toEqual([]);
  });
  it("drops gifts whose icon is not a secure URL", () => {
    expect(mapRoomGifts([{ ...gift, image: { urlList: ["http://insecure.example/x.png"] } }])).toEqual([]);
  });
  it("accepts gifts without an icon", () => {
    const [g] = mapRoomGifts([{ ...gift, image: undefined }]);
    expect(g.icon_url).toBeNull();
    expect(g.raw.image.url_list).toEqual([]);
  });
  it("marks only type-1 gifts as streakable", () => {
    expect(mapRoomGifts([{ ...gift, type: 2 }])[0].streakable).toBe(false);
  });
});
