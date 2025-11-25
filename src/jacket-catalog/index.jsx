import React from "react";
import { createRoot } from "react-dom/client";
import jacketsData from "./jackets.json"; // adjust path as needed
import { PlusCircle, Star, ShoppingBag } from "lucide-react";

function JacketCatalog() {
  const jackets = jacketsData?.catalog || [];

  return (
    <div className="antialiased w-full text-black px-4 pb-2 border border-black/10 rounded-2xl sm:rounded-3xl overflow-hidden bg-white">
      <div className="max-w-full">
        {/* Header */}
        <div className="flex flex-row items-center gap-4 border-b border-black/5 py-4">
          <div
            className="sm:w-18 w-16 aspect-square rounded-xl bg-cover bg-center"
            style={{
              backgroundImage:
                "url(https://images.unsplash.com/photo-1517849845537-4d257902454a?q=80&w=400&auto=format&fit=crop)",
            }}
          ></div>

          <div>
            <div className="text-base sm:text-xl font-medium">
              Jacket Catalog
            </div>
            <div className="text-sm text-black/60">
              Explore our selection of jackets for every season.
            </div>
          </div>

          <div className="flex-auto hidden sm:flex justify-end pr-2">
            <button
              type="button"
              className="cursor-pointer inline-flex items-center gap-2 rounded-full bg-black text-white px-4 py-1.5 sm:text-md text-sm font-medium hover:opacity-90"
            >
              <ShoppingBag className="h-4 w-4" />
              View Cart
            </button>
          </div>
        </div>

        {/* List */}
        <div className="min-w-full text-sm flex flex-col">
          {jackets.map((jacket, i) => (
            <div
              key={jacket.id}
              className="px-3 -mx-2 rounded-2xl hover:bg-black/5 transition"
            >
              <div
                className="flex w-full items-center gap-2"
                style={{
                  borderBottom:
                    i === jackets.length - 1
                      ? "none"
                      : "1px solid rgba(0, 0, 0, 0.05)",
                }}
              >
                {/* Left block */}
                <div className="py-3 pr-3 min-w-0 w-full sm:w-3/5">
                  <div className="flex items-center gap-3">
                    <img
                      src={jacket.image}
                      alt={jacket.name}
                      className="h-12 w-12 sm:h-14 sm:w-14 rounded-lg object-cover ring ring-black/5"
                    />

                    <div className="w-3 text-end sm:block hidden text-sm text-black/40">
                      {i + 1}
                    </div>

                    <div className="min-w-0 sm:pl-1 flex flex-col items-start">
                      <div className="font-medium text-sm sm:text-md truncate max-w-[40ch]">
                        {jacket.name}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-black/70 text-xs sm:text-sm mt-0.5">
                        {/* Rating (mocked or optional) */}
                        <div className="flex items-center gap-1">
                          <Star
                            strokeWidth={1.5}
                            className="h-3 w-3 text-black"
                          />
                          <span>4.5</span>
                        </div>

                        {/* Colors */}
                        <div className="whitespace-nowrap">
                          {jacket.colors.join(", ")}
                        </div>

                        {/* Sizes */}
                        <div className="whitespace-nowrap">
                          {jacket.sizes.join(", ")}
                        </div>
                      </div>

                      <div className="text-sm text-black font-semibold mt-1">
                        ${jacket.price.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stock status */}
                <div className="hidden sm:block text-end py-2 px-3 text-sm text-black/60 whitespace-nowrap flex-auto">
                  {jacket.inStock ? "In stock" : "Out of stock"}
                </div>

                {/* Add Button */}
                <div className="py-2 pr-2 sm:pr-4 flex justify-end">
                  <button
                    type="button"
                    className="cursor-pointer inline-flex items-center text-black/70 hover:text-black"
                    aria-label={`Add ${jacket.name} to cart`}
                  >
                    <PlusCircle strokeWidth={1.5} className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {jackets.length === 0 && (
            <div className="py-6 text-center text-black/60">
              No jackets found.
            </div>
          )}
        </div>

        {/* Mobile footer */}
        <div className="sm:hidden px-0 pt-2 pb-2">
          <button
            type="button"
            className="w-full cursor-pointer inline-flex items-center justify-center gap-2 rounded-full bg-black text-white px-4 py-2 font-medium hover:opacity-90"
          >
            <ShoppingBag className="h-4 w-4" />
            View Cart
          </button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("jacket-catalog-root")).render(
  <JacketCatalog />
);
