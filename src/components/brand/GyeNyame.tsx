/**
 * Gye Nyame — "Except for God".
 *
 * The Adinkra symbol of the Akan people of Ghana, and OBOLO's mark. The symbol
 * itself is traditional and centuries old; this particular vector is the
 * Wikimedia Commons rendering released under CC0, so it carries no attribution
 * requirement and is free for commercial use.
 *
 * DO NOT REDRAW THIS PATH BY HAND. It is a specific traditional glyph, not a
 * generic swirl, and an approximation of it is wrong in a way that is obvious
 * to anyone who grew up with it. Replace it only with another faithful vector.
 *
 * The viewBox is the glyph's own bounding box, so it sits flush against its
 * edges and callers can position it without compensating for dead space.
 * `fill="currentColor"` lets it take the colour of whatever it sits in --
 * concrete on the dark rail, ink on a light page.
 */
export function GyeNyame({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="-0.15 -0.23 435 501"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="currentColor"
    >
      {title ? <title>{title}</title> : null}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M180.475,11.245c11.609,15.968,7.794,46.741,26.767,55.644c26.062-0.674,25.307-27.081,40.147-38.522c37.423-25.598,80.812-4.661,84.757,21.401c8.344,55.104-94.203,80.456-84.757,136.968c9.536,33.494,46.84-40.814,80.296-4.281c29.544,65.467-102.894,51.963-95.405,99.257c8.479,69.408,83.598-43.18,99.866,7.75c7.444,61.115-90.009,39.543-71.376,85.605c31.053,43.338,93.146-42.834,84.878-31.873c43.16-57.209,85.813-159.123,29.777-256.006c99.626,91.095,71.729,313.357-69.21,350.594c14.787,9.459,18.504,36.646,8.087,48.568c-10.346,11.842-36.933,22.807-57.991,4.281c-10.31-14.361,2.403-39.824-26.765-47.08c-18.745-4.664-32.433,39.398-55.647,52.135c-15.555,8.533-43.473,1.455-59.915-15.34c-14.078-14.379-14.788-47.295,0.466-56.301c26.519-15.656,80.032-33.082,83.868-87.5c-5.471-40.646-59.689,35.025-84.756,8.559c-34.083-68.123,83.784-46.83,89.217-102.725c-0.074-36.338-67.55,32.542-89.217-8.562c-38.333-69.896,114.667-36.896,93.68-94.165c-24.013-47.731-112.56,5.376-147.334,72.364c-19.86,38.258-46.917,121.406-34.647,187.93C-22.375,289.606-9.89,111.731,125.831,70.548c-16.777-6.39-21.382-28.988-8.3-51.689C125.911,4.318,159.07-11.08,180.475,11.245z"
      />
    </svg>
  );
}
