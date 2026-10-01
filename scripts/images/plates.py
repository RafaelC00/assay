"""Prompts for the blank packaging plates. One plate = one container with an
empty white label panel. Every label, wordmark and line of type is drawn later
as SVG (see labels.py), because generated type is malformed and because a
blank plate cannot resemble any real brand's trade dress."""

SCENE = (
    "Studio product photograph, square 1:1. Front-on view at eye level, the product centred "
    "and filling about 65% of the frame height. Flat, evenly lit, seamless warm light-grey "
    "backdrop (hex E8E5DF) with no gradient and no vignette, one soft diffused key light from "
    "the upper left, a soft contact shadow directly beneath the product. Photorealistic, sharp "
    "focus, commercial e-commerce catalogue style. The product is a generic unbranded "
    "container. Its label panel is completely blank: plain matte white paper, no text, no "
    "logo, no graphics, no barcode, no icons anywhere on the product."
)

PLATES = {
    "kestrel-bottle": "A squat round matte white HDPE supplement bottle with a wide shoulder and a black ribbed screw cap. A tall rectangular wrap-around blank white label covers the middle of the bottle.",
    "kestrel-tall": "A tall slim matte white HDPE supplement bottle with a black ribbed screw cap. A tall rectangular wrap-around blank white label covers the middle of the bottle.",
    "elia-bottle": "A round supplement bottle in matte frosted blush-pink plastic with softly rounded shoulders and a cream-coloured screw cap. A wrap-around blank white label covers the middle of the bottle.",
    "elia-wide": "A wide, short supplement jar in matte frosted blush-pink plastic with a cream-coloured screw cap. A wrap-around blank white label covers the middle of the jar.",
    "meridian-jar": "An amber glass apothecary-style supplement bottle with a matte deep forest-green screw cap. A wrap-around blank off-white paper label covers the middle of the bottle.",
    "meridian-wide": "A wide, short amber glass supplement jar with a matte deep forest-green screw cap. A wrap-around blank off-white paper label covers the middle of the jar.",
    "vireo-bottle": "A round supplement bottle in matte sage-green plastic with a white screw cap. A wrap-around blank white label covers the middle of the bottle.",
    "vireo-tub": "A large cylindrical powder tub in matte sage-green plastic with a flat white screw lid. A wrap-around blank white label covers the middle of the tub.",
    "northbound-tub": "A large cylindrical protein powder tub in matte deep navy-blue plastic with a flat white screw lid. A wrap-around blank white label covers the middle of the tub.",
    "northbound-small": "A smaller cylindrical powder tub in matte deep navy-blue plastic with a flat white screw lid. A wrap-around blank white label covers the middle of the tub.",
    "northbound-box": "A rectangular cardboard carton for single-serve stick packs, matte deep navy-blue, standing upright and viewed straight on from the front. A large blank white rectangular label panel covers most of the front face.",
    "northbound-pouch": "A matte deep navy-blue stand-up resealable pouch with a flat bottom gusset and a zip-seal top, standing upright and viewed straight on. A large blank white rectangular label panel covers most of the front face.",
}

# Label panel on each plate, in plate pixels (x0, y0, x1, y1), measured by
# eye on the generated plate, and how strongly the label wraps round the body
# (visible half-angle in degrees; 0 = flat face such as a carton).
LAYOUT = {
    "kestrel-bottle": {"bbox": (318, 388, 700, 803), "wrap": 62},
    "kestrel-tall": {"bbox": (404, 330, 621, 807), "wrap": 62},
    "elia-bottle": {"bbox": (322, 413, 700, 815), "wrap": 62},
    "elia-wide": {"bbox": (262, 440, 760, 742), "wrap": 62},
    "meridian-jar": {"bbox": (338, 425, 686, 778), "wrap": 62},
    "meridian-wide": {"bbox": (310, 418, 712, 757), "wrap": 62},
    "vireo-bottle": {"bbox": (338, 407, 686, 775), "wrap": 62},
    "vireo-tub": {"bbox": (285, 410, 738, 738), "wrap": 62},
    "northbound-tub": {"bbox": (293, 405, 731, 740), "wrap": 62},
    "northbound-small": {"bbox": (297, 411, 727, 738), "wrap": 62},
    "northbound-box": {"bbox": (334, 296, 690, 772), "wrap": 0},
    "northbound-pouch": {"bbox": (338, 328, 688, 812), "wrap": 0},
}

# Which plate carries which product. Same container, different label.
PRODUCT_PLATE = {
    "kestrel-omega-3-triglyceride": "kestrel-tall",
    "kestrel-magnesium-glycinate": "kestrel-bottle",
    "kestrel-magnesium-threonate": "kestrel-bottle",
    "kestrel-zinc-picolinate": "kestrel-tall",
    "elia-prenatal-multi": "elia-bottle",
    "elia-prenatal-dha": "elia-wide",
    "elia-b-complex-methylated": "elia-bottle",
    "meridian-ashwagandha-root": "meridian-jar",
    "meridian-rhodiola-rosea": "meridian-wide",
    "meridian-lions-mane": "meridian-jar",
    "meridian-turmeric-curcumin": "meridian-wide",
    "vireo-plant-protein": "vireo-tub",
    "vireo-algae-omega-3": "vireo-bottle",
    "vireo-vitamin-c-acerola": "vireo-bottle",
    "vireo-d3-k2": "vireo-bottle",
    "northbound-creatine-monohydrate": "northbound-small",
    "northbound-whey-isolate": "northbound-tub",
    "northbound-electrolyte-mix": "northbound-box",
    "northbound-collagen-peptides": "northbound-pouch",
    "northbound-magnesium-citrate": "northbound-small",
}

# What the container looks like, for alt text. The label wording is added from the catalog.
PLATE_ALT = {
    "kestrel-bottle": "a matte white supplement bottle with a black ribbed cap",
    "kestrel-tall": "a tall slim matte white supplement bottle with a black ribbed cap",
    "elia-bottle": "a matte blush-pink supplement bottle with a cream cap",
    "elia-wide": "a wide matte blush-pink supplement jar with a cream cap",
    "meridian-jar": "an amber glass supplement bottle with a deep green cap",
    "meridian-wide": "a wide amber glass supplement jar with a deep green cap",
    "vireo-bottle": "a matte sage-green supplement bottle with a white cap",
    "vireo-tub": "a large matte sage-green powder tub with a white lid",
    "northbound-tub": "a large matte navy powder tub with a white lid",
    "northbound-small": "a matte navy powder tub with a white lid",
    "northbound-box": "an upright matte navy carton of single-serve sticks",
    "northbound-pouch": "an upright matte navy resealable pouch",
}
