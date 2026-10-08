export interface Testimonial {
  names: string;
  location: string;
  year: string;
  quote: string;
  rating: number;
  photo: string;
}

export const TESTIMONIALS: Testimonial[] = [
  {
    names: "Ananya & Rohan",
    location: "Pune, India",
    year: "Married 2024",
    quote:
      "We matched on our shared values before anything else — the compatibility breakdown made it easy to see why we clicked. Forever grateful to RishteyZindagi.",
    rating: 5,
    photo: "https://images.pexels.com/photos/7580821/pexels-photo-7580821.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop",
  },
  {
    names: "Priya & Arjun",
    location: "Ahmedabad, India → Doha, Qatar",
    year: "Married 2023",
    quote:
      "Being an NRI, I worried about finding someone who still understood home. The India + NRI filters got me there in weeks, not months.",
    rating: 5,
    photo: "https://images.pexels.com/photos/7580822/pexels-photo-7580822.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop",
  },
  {
    names: "Sneha & Karan",
    location: "Bengaluru, India",
    year: "Married 2022",
    quote:
      "Verified profiles gave both our families real peace of mind from day one. The whole process felt respectful and never rushed.",
    rating: 4.5,
    photo: "https://images.pexels.com/photos/7580948/pexels-photo-7580948.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop",
  },
  {
    names: "Meera & Vikram",
    location: "Jaipur, India",
    year: "Married 2024",
    quote:
      "My parents were nervous about an online platform, but the verification process and how much detail we could share up front won them over quickly.",
    rating: 5,
    photo: "https://images.pexels.com/photos/7580994/pexels-photo-7580994.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop",
  },
  {
    names: "Fatima & Imran",
    location: "Hyderabad, India → Kuwait City, Kuwait",
    year: "Married 2023",
    quote:
      "We were both settled abroad and short on time. The smart recommendations meant we only ever spent time on profiles that actually fit what we wanted.",
    rating: 5,
    photo: "https://images.pexels.com/photos/7580640/pexels-photo-7580640.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop",
  },
  {
    names: "Simran & Gurpreet",
    location: "Chandigarh, India",
    year: "Married 2022",
    quote:
      "The safety features made my family comfortable letting me take my time. We talked for four months before ever meeting in person — no pressure at all.",
    rating: 4.5,
    photo: "https://images.pexels.com/photos/7580984/pexels-photo-7580984.jpeg?auto=compress&cs=tinysrgb&w=200&h=200&fit=crop",
  },
];
