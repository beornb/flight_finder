"use client";

import type { CabinClass, ProviderChoice } from "@/lib/search/types";
import { LocationSelect, type LocationValue } from "./location-select";

export type SearchFormValues = {
  origin: LocationValue;
  destination: LocationValue;
  returnFrom: LocationValue;
  returnTo: LocationValue;
  outboundDateFrom: string;
  outboundDateTo: string;
  returnDateFrom: string;
  returnDateTo: string;
  directOnly: boolean;
  outboundOnly: boolean;
  adults: number;
  cabinClass: CabinClass;
  thorough: boolean;
  checkedBagIncluded: boolean;
  allowSeparateTicketsSameAirportOnly: boolean;
  // Null means no limit.
  maxLegHours: number | null;
  provider: ProviderChoice;
};

function isoDatePlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export const DEFAULT_SEARCH_VALUES: SearchFormValues = {
  origin: { kind: "airport", code: "VIE" },
  destination: { kind: "country", code: "PT" },
  returnFrom: { kind: "country", code: "IT" },
  returnTo: { kind: "country", code: "AT" },
  outboundDateFrom: isoDatePlusDays(30),
  outboundDateTo: isoDatePlusDays(37),
  returnDateFrom: isoDatePlusDays(40),
  returnDateTo: isoDatePlusDays(47),
  directOnly: true,
  outboundOnly: false,
  adults: 1,
  cabinClass: "ECONOMY",
  thorough: false,
  checkedBagIncluded: false,
  allowSeparateTicketsSameAirportOnly: true,
  maxLegHours: null,
  provider: "all",
};

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 " +
  "focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-sky-900";

const labelClass = "mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

type FieldProps = {
  label: string;
  dimmed?: boolean;
  children: React.ReactNode;
};

function Field({ label, dimmed, children }: FieldProps) {
  return (
    <div className={dimmed ? "pointer-events-none opacity-40" : undefined}>
      <span className={labelClass}>{label}</span>
      {children}
    </div>
  );
}

type SearchFormProps = {
  values: SearchFormValues;
  onChange: (values: SearchFormValues) => void;
  loading: boolean;
  onSearch: (values: SearchFormValues) => void;
  onClear: () => void;
};

export function SearchForm({ values, onChange, loading, onSearch, onClear }: SearchFormProps) {
  function set<K extends keyof SearchFormValues>(key: K, value: SearchFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <form
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(values);
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="From airport">
          <LocationSelect airportsOnly value={values.origin} onChange={(v) => set("origin", v)} />
        </Field>
        <Field label="Fly to">
          <LocationSelect value={values.destination} onChange={(v) => set("destination", v)} />
        </Field>
        <Field label="Outbound from">
          <input
            className={inputClass}
            type="date"
            value={values.outboundDateFrom}
            onChange={(e) => set("outboundDateFrom", e.target.value)}
            required
          />
        </Field>
        <Field label="Outbound until">
          <input
            className={inputClass}
            type="date"
            value={values.outboundDateTo}
            onChange={(e) => set("outboundDateTo", e.target.value)}
            required
          />
        </Field>
        <Field label="Return from" dimmed={values.outboundOnly}>
          <LocationSelect
            value={values.returnFrom}
            onChange={(v) => set("returnFrom", v)}
            disabled={values.outboundOnly}
          />
        </Field>
        <Field label="Return to" dimmed={values.outboundOnly}>
          <LocationSelect
            value={values.returnTo}
            onChange={(v) => set("returnTo", v)}
            disabled={values.outboundOnly}
          />
        </Field>
        <Field label="Return date from" dimmed={values.outboundOnly}>
          <input
            className={inputClass}
            type="date"
            value={values.returnDateFrom}
            onChange={(e) => set("returnDateFrom", e.target.value)}
            disabled={values.outboundOnly}
            required={!values.outboundOnly}
          />
        </Field>
        <Field label="Return date until" dimmed={values.outboundOnly}>
          <input
            className={inputClass}
            type="date"
            value={values.returnDateTo}
            onChange={(e) => set("returnDateTo", e.target.value)}
            disabled={values.outboundOnly}
            required={!values.outboundOnly}
          />
        </Field>
        <Field label="Travellers">
          <input
            className={inputClass}
            type="number"
            min={1}
            max={9}
            value={values.adults}
            onChange={(e) => set("adults", Number(e.target.value))}
          />
        </Field>
        <Field label="Cabin">
          <select
            className={inputClass}
            value={values.cabinClass}
            onChange={(e) => set("cabinClass", e.target.value as CabinClass)}
          >
            <option value="ECONOMY">Economy</option>
            <option value="PREMIUM_ECONOMY">Premium economy</option>
            <option value="BUSINESS">Business</option>
            <option value="FIRST">First</option>
          </select>
        </Field>
        <Field label="Max hours per flight">
          <input
            className={inputClass}
            type="number"
            min={1}
            max={72}
            placeholder="No limit"
            value={values.maxLegHours ?? ""}
            onChange={(e) => set("maxLegHours", e.target.value === "" ? null : Number(e.target.value))}
          />
        </Field>
        <Field label="Flight data">
          <select
            className={inputClass}
            value={values.provider}
            onChange={(e) => set("provider", e.target.value as ProviderChoice)}
          >
            <option value="all">All providers</option>
            <option value="ignav">Ignav</option>
            <option value="duffel">Duffel</option>
            <option value="serpapi">Google Flights (SerpApi)</option>
            <option value="mock">Mock (offline)</option>
          </select>
        </Field>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-zinc-100 pt-5 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-300 sm:flex-row sm:gap-6">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-600"
              checked={values.directOnly}
              onChange={(e) => set("directOnly", e.target.checked)}
            />
            Direct only
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-600"
              checked={values.outboundOnly}
              onChange={(e) => set("outboundOnly", e.target.checked)}
            />
            Outbound only
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-600"
              checked={values.checkedBagIncluded}
              onChange={(e) => set("checkedBagIncluded", e.target.checked)}
            />
            Checked bag included
          </label>
          <label
            className="flex items-center gap-2"
            title="Search every date and more airports per country — slower and uses more provider requests"
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-600"
              checked={values.thorough}
              onChange={(e) => set("thorough", e.target.checked)}
            />
            Thorough search
          </label>
          <label
            className={`flex items-center gap-2 ${values.outboundOnly ? "pointer-events-none opacity-40" : ""}`}
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-600"
              checked={values.allowSeparateTicketsSameAirportOnly}
              onChange={(e) => set("allowSeparateTicketsSameAirportOnly", e.target.checked)}
              disabled={values.outboundOnly}
            />
            Separate tickets, same airport only
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={loading}
            className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Reset
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Searching…" : "Find best trips"}
          </button>
        </div>
      </div>
    </form>
  );
}
