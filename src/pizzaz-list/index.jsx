import React from "react";
import { createRoot } from "react-dom/client";
import markers from "../pizzaz/markers.json";
import { PlusCircle, Star } from "lucide-react";
import { useOpenAiGlobal } from "../use-openai-global";
import { computePriceRange } from "../utils/price-range";

const defaultRestaurants = markers?.places ?? [];

function resolveRequestedTopping({
  templateParams,
  metadata,
  toolInput,
  toppingsLookup,
}) {
  const sources = [
    templateParams?.pizzaTopping,
    metadata?.["openai/outputTemplateValues"]?.pizzaTopping,
    toolInput?.pizzaTopping,
  ];

  for (const value of sources) {
    if (typeof value !== "string") continue;
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch (error) {
      // ignore decode errors and fall back to the original string
    }
    const trimmed = decoded.trim();
    if (!trimmed) continue;
    if (/^\{[^}]+\}$/.test(trimmed)) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    const canonical = toppingsLookup?.get(normalized);
    if (!canonical) {
      continue;
    }
    return canonical;
  }

  return "";
}

function App() {
  const restaurants = React.useMemo(() => defaultRestaurants, []);
  const menuItems = React.useMemo(() => {
    return restaurants.flatMap((place) => {
      const priceRange = computePriceRange(place.menu ?? []);
      return (place.menu ?? []).map((item) => ({
        ...item,
        toppings: (item.toppings ?? []).map((topping) => topping.trim()).filter(Boolean),
        restaurant: {
          id: place.id,
          name: place.name,
          city: place.city,
          rating: place.rating,
          priceRange,
          thumbnail: item.image ?? place.thumbnail,
          baseThumbnail: place.thumbnail
        }
      }));
    });
  }, [restaurants]);

  const toppingsByNormalized = React.useMemo(() => {
    const map = new Map();
    menuItems.forEach((item) => {
      (item.toppings ?? []).forEach((topping) => {
        const normalized = topping.trim().toLowerCase();
        if (!normalized || map.has(normalized)) return;
        map.set(normalized, topping);
      });
    });
    return map;
  }, [menuItems]);

  const sortedMenuItems = React.useMemo(() => {
    return [...menuItems].sort((a, b) => {
      const ratingA = a.restaurant?.rating ?? 0;
      const ratingB = b.restaurant?.rating ?? 0;
      if (ratingA === ratingB) {
        return (a.name || "").localeCompare(b.name || "");
      }
      return ratingB - ratingA;
    });
  }, [menuItems]);

  const toolInput = useOpenAiGlobal("toolInput") ?? {};
  const toolResponseMetadata = useOpenAiGlobal("toolResponseMetadata") ?? {};
  const templateParams = window?.__PIZZAZ_TEMPLATE_PARAMS__ ?? {};
  const requestedTopping = resolveRequestedTopping({
    templateParams,
    metadata: toolResponseMetadata,
    toolInput,
    toppingsLookup: toppingsByNormalized,
  });
  const normalizedTopping = requestedTopping.toLowerCase();
  const filteredItems = normalizedTopping
    ? sortedMenuItems.filter((item) =>
        item.toppings?.some(
          (topping) => topping.toLowerCase() === normalizedTopping,
        ),
      )
    : sortedMenuItems;
  const visibleItems = filteredItems;
  const hasFilter = Boolean(requestedTopping);
  const noResults = filteredItems.length === 0;

  return (
    <div className="antialiased w-full text-black px-4 pb-2 border border-black/10 rounded-2xl sm:rounded-3xl overflow-hidden bg-white">
      <div className="max-w-full">
        <div className="flex flex-row items-center gap-4 sm:gap-4 border-b border-black/5 py-4">
          <div
            className="sm:w-18 w-16 aspect-square rounded-xl bg-cover bg-center"
            style={{
              backgroundImage:
                "url(https://persistent.oaistatic.com/pizzaz/title.png)",
            }}
          ></div>
          <div>
            <div className="text-base sm:text-xl font-medium">
              National Best Pizza List
            </div>
            <div className="text-sm text-black/60">
              A ranking of the best pizzerias in the world
            </div>
          </div>
          <div className="flex-auto hidden sm:flex justify-end pr-2">
            <button
              type="button"
              className="cursor-pointer inline-flex items-center rounded-full bg-[#F46C21] text-white px-4 py-1.5 sm:text-md text-sm font-medium hover:opacity-90 active:opacity-100"
            >
              Save List
            </button>
          </div>
        </div>
        {hasFilter && (
          <div className="flex items-center justify-between px-2 py-2 text-sm text-black/70">
            <div>
              Showing pizzas with topping:
              <span className="ml-1 font-medium capitalize">{requestedTopping}</span>
            </div>
            <div className="hidden sm:block text-xs text-black/50">
              {noResults ? "No matches" : `${filteredItems.length} matches`}
            </div>
          </div>
        )}
        <div
          className="min-w-full text-sm flex flex-col overflow-y-auto overflow-x-hidden pr-1"
          style={{ maxHeight: "calc(7 * 88px)" }}
        >
          {visibleItems.map((item, i) => (
            <div
              key={item.id}
              className="px-3 -mx-2 rounded-2xl hover:bg-black/5"
            >
              <div
                className="flex flex-col gap-2 py-3 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center hover:border-black/0!"
                style={{
                  borderBottom:
                    i === visibleItems.length - 1 ? "none" : "1px solid rgba(0, 0, 0, 0.05)"
                }}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="hidden sm:flex w-5 justify-end text-xs text-black/40 pt-1">
                    {i + 1}
                  </div>
                  <img
                    src={item.image ?? item.restaurant?.thumbnail ?? item.restaurant?.baseThumbnail}
                    alt={item.name}
                    className="h-10 w-10 sm:h-11 sm:w-11 rounded-lg object-cover ring ring-black/5"
                  />
                  <div className="min-w-0 flex flex-col">
                    <div className="font-medium text-sm sm:text-md truncate">
                      {item.name}
                    </div>
                    {item.description ? (
                      <div className="text-xs text-black/60 mt-1 line-clamp-2">
                        {item.description}
                      </div>
                    ) : null}
                    {item.price ? (
                      <div className="text-sm text-black/80 mt-1">{item.price}</div>
                    ) : null}
                    <div className="flex items-center gap-2 text-xs text-black/60 mt-2 sm:hidden">
                      <span className="font-medium truncate">{item.restaurant?.name || "–"}</span>
                      <span className="text-black/40 truncate max-w-[20ch]">
                        {item.restaurant?.city || ""}
                      </span>
                      <div className="flex items-center gap-1">
                        <Star strokeWidth={1.5} className="h-3 w-3 text-black" />
                        <span>
                          {item.restaurant?.rating?.toFixed
                            ? item.restaurant.rating.toFixed(1)
                            : item.restaurant?.rating}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="hidden sm:flex flex-col text-right text-sm text-black/70 whitespace-nowrap">
                  <span className="font-medium">{item.restaurant?.name || "–"}</span>
                  <span className="text-xs text-black/50 mt-0.5">{item.restaurant?.city || ""}</span>
                  <div className="flex items-center justify-end gap-1 text-xs text-black/60 mt-1">
                    <Star strokeWidth={1.5} className="h-3 w-3 text-black" />
                    <span>
                      {item.restaurant?.rating?.toFixed
                        ? item.restaurant.rating.toFixed(1)
                        : item.restaurant?.rating}
                    </span>
                  </div>
                </div>
                <div className="py-2 whitespace-nowrap flex justify-end">
                  <PlusCircle strokeWidth={1.5} className="h-5 w-5" />
                </div>
              </div>
            </div>
          ))}
          {noResults && (
            <div className="py-6 text-center text-black/60">
              No pizzerias found{hasFilter ? ` for “${requestedTopping}”.` : "."}
            </div>
          )}
        </div>
        <div className="sm:hidden px-0 pt-2 pb-2">
          <button
            type="button"
            className="w-full cursor-pointer inline-flex items-center justify-center rounded-full bg-[#F46C21] text-white px-4 py-2 font-medium hover:opacity-90 active:opacity-100"
          >
            Save List
          </button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("pizzaz-list-root")).render(<App />);
