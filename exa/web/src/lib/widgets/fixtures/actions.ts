import { toSource, type ActionsData } from "@/lib/widgets/types";

export const actionsFixture: ActionsData = {
  kind: "actions",
  title: "Dinner at Savoy, Friday 19:30",
  actions: [
    {
      type: "book",
      label: "Book a table for 4",
      description: "Friday 21 Nov, 19:30 on the restaurant's booking page",
      href: "https://www.ravintolasavoy.fi/en/",
      primary: true,
    },
    {
      type: "directions",
      label: "Get directions",
      description: "Eteläesplanadi 14, 9 min walk from Kamppi",
      href: "https://www.google.com/maps/dir/?api=1&destination=Etel%C3%A4esplanadi+14%2C+Helsinki",
    },
    {
      type: "call",
      label: "Call the restaurant",
      description: "+358 9 6128 5300",
      href: "tel:+358961285300",
    },
    {
      type: "calendar",
      label: "Add to calendar",
      description: "Google Calendar, with the address",
      href: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Dinner+at+Savoy&dates=20261121T173000Z/20261121T200000Z&location=Etel%C3%A4esplanadi+14%2C+Helsinki",
    },
    {
      type: "email",
      label: "Email the plan",
      description: "Send the details to the group",
      href: "mailto:?subject=Dinner%20at%20Savoy%2C%20Friday%2019%3A30&body=Table%20for%204%20at%20Savoy%2C%20Etel%C3%A4esplanadi%2014.",
    },
  ],
  sources: [
    toSource({ url: "https://www.ravintolasavoy.fi/en/", title: "Ravintola Savoy" }),
  ],
};

export const actionsLoadingFixture: ActionsData = {
  kind: "actions",
  stage: "Finding the booking page",
  actions: [],
  sources: [],
};
