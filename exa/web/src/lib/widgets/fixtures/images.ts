import { toSource, type ImagesData } from "@/lib/widgets/types";

const W = "https://upload.wikimedia.org/wikipedia/commons/thumb";

export const imagesFixture: ImagesData = {
  kind: "images",
  query: "Alvar Aalto architecture and Finnish design",
  images: [
    {
      url: `${W}/a/af/Finlandia_Hall%2C_Helsinki_-_DSC03957.JPG/960px-Finlandia_Hall%2C_Helsinki_-_DSC03957.JPG`,
      title: "Finlandia Hall on Töölönlahti bay, Helsinki",
      pageUrl: "https://en.wikipedia.org/wiki/Finlandia_Hall",
      domain: "en.wikipedia.org",
    },
    {
      url: `${W}/3/3f/Villa_Mairea%2C_1.jpg/960px-Villa_Mairea%2C_1.jpg`,
      title: "Villa Mairea, Noormarkku",
      pageUrl: "https://www.villamairea.fi/en",
      domain: "villamairea.fi",
    },
    {
      url: `${W}/e/e4/S%C3%A4yn%C3%A4tsalo_Town_Hall_council_chamber_rafters.jpg/960px-S%C3%A4yn%C3%A4tsalo_Town_Hall_council_chamber_rafters.jpg`,
      title: "Säynätsalo Town Hall, council chamber rafters",
      pageUrl: "https://www.alvaraalto.fi/en/architecture/saynatsalo-town-hall/",
      domain: "alvaraalto.fi",
    },
    {
      url: `${W}/0/08/Terrace_of_Paimio_sanatorium_by_Alvar_Aalto.jpg/960px-Terrace_of_Paimio_sanatorium_by_Alvar_Aalto.jpg`,
      title: "Sun terraces of Paimio Sanatorium",
      pageUrl: "https://www.paimiosanatorium.com/en",
      domain: "paimiosanatorium.com",
    },
    {
      url: `${W}/3/37/Alvar_Aalto._Stool_60.jpg/960px-Alvar_Aalto._Stool_60.jpg`,
      title: "Stool 60, bent birch, 1933",
      pageUrl: "https://www.artek.fi/en/products/stool-60",
      domain: "artek.fi",
    },
    {
      url: `${W}/c/ca/Alvar_Aallon_ateljee.jpg/960px-Alvar_Aallon_ateljee.jpg`,
      title: "Studio Aalto, Munkkiniemi",
      pageUrl: "https://www.alvaraalto.fi/en/location/studio-aalto/",
      domain: "alvaraalto.fi",
    },
    {
      url: `${W}/9/98/Ngv_design%2C_alvar_aalto%2C_armchair_41%2C_1930.JPG/960px-Ngv_design%2C_alvar_aalto%2C_armchair_41%2C_1930.JPG`,
      title: "Armchair 41 “Paimio”, 1930",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Ngv_design,_alvar_aalto,_armchair_41,_1930.JPG",
      domain: "commons.wikimedia.org",
    },
    {
      url: `${W}/b/be/Finlandia_Hall_lobby.jpg/960px-Finlandia_Hall_lobby.jpg`,
      title: "Finlandia Hall lobby after the 2024 renovation",
      pageUrl: "https://www.finlandiatalo.fi/en/",
      domain: "finlandiatalo.fi",
    },
    {
      url: `${W}/3/3b/Paimio_Sanatorium.jpg/960px-Paimio_Sanatorium.jpg`,
      title: "Paimio Sanatorium patient wing",
      pageUrl: "https://en.wikipedia.org/wiki/Paimio_Sanatorium",
      domain: "en.wikipedia.org",
    },
    {
      url: `${W}/d/d8/Interior_of_Aalto_Muuratsalo_experimental_house_01.jpg/960px-Interior_of_Aalto_Muuratsalo_experimental_house_01.jpg`,
      title: "Muuratsalo Experimental House, living room",
      pageUrl: "https://www.visitfinland.com/en/places-to-go/lakeland/jyvaskyla/",
      domain: "visitfinland.com",
    },
    {
      url: `${W}/1/11/Alvar-Aalto-apt-bldg-Turku-Finland.jpg/960px-Alvar-Aalto-apt-bldg-Turku-Finland.jpg`,
      title: "Standard apartment building, Turku",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Alvar-Aalto-apt-bldg-Turku-Finland.jpg",
      domain: "commons.wikimedia.org",
    },
    {
      url: "https://upload.wikimedia.org/wikipedia/commons/3/32/Aalto-maljakko%2C_Iittala._Alvar_Aalto._1956_-_n.1970-luku.jpg",
      title: "Aalto vase by Iittala",
      pageUrl: "https://www.iittala.com/en-fi/collections/alvar-aalto-collection",
      domain: "iittala.com",
    },
  ],
  sources: [
    toSource({ url: "https://en.wikipedia.org/wiki/Alvar_Aalto", title: "Alvar Aalto - Wikipedia" }),
    toSource({ url: "https://www.alvaraalto.fi/en/", title: "Alvar Aalto Foundation" }),
    toSource({ url: "https://www.artek.fi/en/", title: "Artek" }),
    toSource({ url: "https://commons.wikimedia.org/wiki/Category:Alvar_Aalto", title: "Category: Alvar Aalto - Wikimedia Commons" }),
  ],
};

export const imagesLoadingFixture: ImagesData = {
  kind: "images",
  query: "Alvar Aalto architecture and Finnish design",
  stage: "Searching for images of Alvar Aalto architecture",
  images: [],
  sources: [],
};
