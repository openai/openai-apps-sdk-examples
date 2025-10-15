import React from "react";
import { MapPin, Star } from "lucide-react";

export default function PlaceCard({ item }) {
  if (!item) return null;
  const restaurant = item.restaurant ?? {};
  return (
    <div className="min-w-[220px] select-none max-w-[220px] w-[65vw] sm:w-[220px] self-stretch flex flex-col">
      <div className="w-full">
        <img
          src={item.image ?? restaurant.thumbnail}
          alt={item.name}
          className="w-full aspect-square rounded-2xl object-cover ring ring-black/5 shadow-[0px_2px_6px_rgba(0,0,0,0.06)]"
        />
      </div>
      <div className="mt-3 flex flex-col flex-1">
        <div className="text-base font-medium truncate line-clamp-1">
          {restaurant.name}
        </div>
        <div className="text-xs mt-1 text-black/60 flex items-center gap-1">
          <Star className="h-3 w-3" aria-hidden="true" />
          {restaurant.rating?.toFixed ? restaurant.rating.toFixed(1) : restaurant.rating}
          {restaurant.priceRange ? <span>· {restaurant.priceRange}</span> : null}
        </div>
        <div className="text-xs mt-1 text-black/60 inline-flex items-center gap-1">
          <MapPin className="h-3 w-3" aria-hidden="true" />
          <span className="truncate">{restaurant.city ?? "San Francisco"}</span>
        </div>
        {item.description ? (
          <div className="text-sm mt-2 text-black/80 flex-auto line-clamp-3">
            {item.description}
          </div>
        ) : null}
        <div className="text-sm text-black/80 mt-2">
          {item.name}
        </div>
        {item.price ? (
          <div className="text-sm text-black/70">{item.price}</div>
        ) : null}
        <div className="mt-5">
          <button
            type="button"
            className="cursor-pointer inline-flex items-center rounded-full bg-[#F46C21] text-white px-4 py-1.5 text-sm font-medium hover:opacity-90 active:opacity-100"
          >
            Learn more
          </button>
        </div>
      </div>
    </div>
  );
}
