export type BookingLink = {
  providerName: string;
  providerType: "airline" | "third_party";
  fareName?: string;
  price?: { amount: number; currency: string };
  url: string;
};

export type BookingLinksResponse = {
  // Keyed by ticket id; a trip plan can span up to three tickets
  // (outbound + two separate return tickets).
  links: Record<string, BookingLink[]>;
  failures: string[];
};
