# ValueGroup count targets

The public target contract already allows `count` and `share` targets whose subject is a `value_group`.

The Question Explorer must expose both modes for an ordinary ValueGroup target:

- final share
- percentage-point change
- relative-percent change
- final count
- count change

A checkbox option using a ValueGroup as its conditional population remains `conditional_share` only. Count modes must not be exposed for that conditional target.

Current ValueGroup count/share values come from the authoritative target profile for the active SourceScope. The renderer does not reconstruct membership counts or denominators from raw responses.

Changing between share and count replaces the existing target for that ValueGroup subject, using the stable target id grammar for the selected kind. It does not create two simultaneous targets for the same ValueGroup.
