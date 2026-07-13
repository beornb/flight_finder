"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  allAirports,
  countryName,
  findAirport,
  findMetroArea,
  metroAreas,
  supportedCountries,
} from "@/lib/data/airports";

// Either a whole country ("Portugal — any airport") or one exact airport.
// Metro codes (LON, TYO) ride in the airport kind and expand server-side.
export type LocationValue =
  | { kind: "country"; code: string }
  | { kind: "airport"; code: string };

type Option = LocationValue & { label: string; detail: string; group: string; keywords?: string };

const COUNTRY_OPTIONS: Option[] = supportedCountries().map((c) => ({
  kind: "country",
  code: c.code,
  label: c.name,
  detail: "Any airport",
  group: "Countries",
}));

const CITY_OPTIONS: Option[] = metroAreas().map((m) => ({
  kind: "airport",
  code: m.code,
  label: `${m.name} — all airports`,
  detail: `${m.airports.join(", ")} · ${countryName(m.country)}`,
  group: "Cities",
  keywords: m.aliases.join(" ").toLowerCase(),
}));

const AIRPORT_OPTIONS: Option[] = allAirports().map((a) => ({
  kind: "airport",
  code: a.iata,
  label: `${a.iata} — ${a.city}`,
  detail: `${a.name}, ${countryName(a.country)}`,
  group: "Airports",
}));

const MAX_PER_GROUP = 6;

export function locationLabel(value: LocationValue): string {
  if (value.kind === "country") return `${countryName(value.code)} — any airport`;
  const metro = findMetroArea(value.code);
  if (metro) return `${metro.name} — all airports`;
  const airport = findAirport(value.code);
  return airport ? `${value.code} — ${airport.city}` : value.code;
}

function matches(option: Option, q: string): boolean {
  return (
    q === "" ||
    option.code.toLowerCase().startsWith(q) ||
    option.label.toLowerCase().includes(q) ||
    option.detail.toLowerCase().includes(q) ||
    (option.keywords?.includes(q) ?? false)
  );
}

function filterOptions(query: string, airportsOnly: boolean): Option[] {
  const q = query.trim().toLowerCase();
  const airports = AIRPORT_OPTIONS.filter((o) => matches(o, q)).slice(
    0,
    airportsOnly ? MAX_PER_GROUP * 2 : MAX_PER_GROUP
  );
  const cities = airportsOnly ? [] : CITY_OPTIONS.filter((o) => matches(o, q));
  const countries = airportsOnly
    ? []
    : COUNTRY_OPTIONS.filter(
        (o) => q === "" || o.label.toLowerCase().includes(q) || o.code.toLowerCase() === q
      ).slice(0, MAX_PER_GROUP);

  const options = [...countries, ...cities, ...airports];
  // Let the user pick an airport code we don't know; the provider knows more
  // airports than our dataset.
  if (/^[A-Za-z]{3}$/.test(q) && !options.some((o) => o.kind === "airport" && o.code.toLowerCase() === q)) {
    options.push({
      kind: "airport",
      code: q.toUpperCase(),
      label: `Use airport code ${q.toUpperCase()}`,
      detail: "Not in the local list",
      group: "Airports",
    });
  }
  return options;
}

type LocationSelectProps = {
  value: LocationValue;
  onChange: (value: LocationValue) => void;
  airportsOnly?: boolean;
  disabled?: boolean;
};

export function LocationSelect({ value, onChange, airportsOnly = false, disabled }: LocationSelectProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);

  const options = useMemo(() => filterOptions(query, airportsOnly), [query, airportsOnly]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function openWith(newQuery: string) {
    setQuery(newQuery);
    setHighlighted(0);
    setOpen(true);
  }

  function select(option: Option) {
    onChange({ kind: option.kind, code: option.code });
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter") {
        event.preventDefault();
        openWith("");
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((h) => Math.min(h + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (options[highlighted]) select(options[highlighted]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const groups: { title: string; items: { option: Option; index: number }[] }[] = [];
  options.forEach((option, index) => {
    const group = groups.find((g) => g.title === option.group);
    if (group) group.items.push({ option, index });
    else groups.push({ title: option.group, items: [{ option, index }] });
  });

  return (
    <div ref={containerRef} className="relative">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-sky-900"
        value={open ? query : locationLabel(value)}
        placeholder={airportsOnly ? "Airport" : "Country or airport"}
        disabled={disabled}
        onFocus={() => openWith("")}
        onChange={(e) => openWith(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {options.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">No matches</li>
          )}
          {groups.map((group) => (
            <li key={group.title}>
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {group.title}
              </p>
              <ul>
                {group.items.map(({ option, index }) => (
                  <li
                    key={`${option.kind}-${option.code}`}
                    role="option"
                    aria-selected={value.kind === option.kind && value.code === option.code}
                    className={`cursor-pointer px-3 py-1.5 ${
                      index === highlighted ? "bg-sky-50 dark:bg-sky-950" : ""
                    }`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      select(option);
                    }}
                    onPointerEnter={() => setHighlighted(index)}
                  >
                    <span className="block text-sm text-zinc-900 dark:text-zinc-100">{option.label}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">{option.detail}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
