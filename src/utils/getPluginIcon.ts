import * as Icons from "lucide-react";
import React from "react";

export const getPluginIcon = (name?: string): React.ComponentType<{ className?: string }> => {
  if (!name) return Icons.Boxes;

  // Handle custom data URLs (SVG or PNG) and image URLs
  if (
    name.startsWith("data:") ||
    name.startsWith("http://") ||
    name.startsWith("https://") ||
    name.startsWith("blob:")
  ) {
    const CustomIconComponent: React.FC<{ className?: string }> = ({ className }) => {
      return React.createElement("img", {
        src: name,
        alt: "",
        className: `${className || "w-4 h-4"} object-contain inline-block shrink-0 rounded-xs`,
      });
    };
    CustomIconComponent.displayName = "CustomPluginIcon";
    return CustomIconComponent;
  }

  // Exact match in Lucide
  const match = (Icons as Record<string, any>)[name];
  if (match) return match;

  // Case-insensitive lookup fallback
  const lower = name.toLowerCase();
  for (const [key, comp] of Object.entries(Icons)) {
    if (key.toLowerCase() === lower) {
      return comp as React.ComponentType<{ className?: string }>;
    }
  }

  return Icons.Boxes;
};
