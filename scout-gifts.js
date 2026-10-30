// Maps connector gift objects to the verified catalog shape the website
// validates (raw must echo id, name, diamond_count and image.url_list).
// Pure module with no imports so it can be tested without TikTok dependencies.
export function mapRoomGifts(gifts) {
  const out = [];
  for (const g of gifts ?? []) {
    const id = String(g?.id ?? "");
    const name = String(g?.name ?? "").trim();
    const diamonds = Number(g?.diamondCount ?? g?.diamond_count);
    const icon = g?.image?.urlList?.[0] ?? g?.image?.url_list?.[0] ?? null;
    const type = Number(g?.type);
    if (!/^[1-9]\d{0,39}$/.test(id) || !name || !Number.isInteger(diamonds) || diamonds < 0 || diamonds > 10000000) continue;
    if (icon !== null && (typeof icon !== "string" || !icon.startsWith("https://"))) continue;
    out.push({
      gift_id: id, name, diamonds,
      icon_url: icon,
      gift_type: Number.isInteger(type) && type >= 0 && type <= 100 ? type : null,
      streakable: type === 1,
      raw: { id, name, diamond_count: diamonds, image: { url_list: icon ? [icon] : [] }, type: Number.isInteger(type) ? type : 0 },
    });
  }
  return out;
}
