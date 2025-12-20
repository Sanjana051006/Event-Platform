"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import EventCard from "@/components/EventCard";
import GradientText from "@/components/GradientText";
import FirstLetterGradientText from "@/components/FirstLetterGradientText";
import FirstWordGradientText from "@/components/FirstWordGradientText";
import LastWordGradientText from "@/components/LastWordGradientText";
import { Building } from "lucide-react";

export default function HomeClient({ upcomingEvents = [], clubs = [] }) {
  // ------------------- ANIMATION (FRAMER MOTION) -------------------

  // Standard fade-up variant for sections
  const FADE_UP_VARIANT = {
    initial: { opacity: 0, y: 25 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { ease: "easeOut", duration: 0.8 },
  };

  // ✅ NEW: Variants for the staggered hero title
  const heroTitleContainerVariants = {
    initial: { opacity: 0 },
    whileInView: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1, // Each word animates 0.1s after the previous
        delayChildren: 0.2, // Start animation after 0.2s
      },
    },
    viewport: { once: true },
  };

  const heroTitleWordVariants = {
    initial: { opacity: 0, y: 20 },
    whileInView: {
      opacity: 1,
      y: 0,
      transition: { ease: "easeOut", duration: 0.6 },
    },
  };
  // -----------------------------------------------------------------

  // ------------------- JSX RENDER -------------------
  return (
    <div>
      {/* HERO SECTION */}
      <section className="bg-brand-gradient text-white py-20">
        <div className="container mx-auto px-4 text-center">
          {/* ✅ MODIFIED: Apply new hero variants */}
          <motion.h1
            className="hero-title text-5xl font-bold mb-6"
            variants={heroTitleContainerVariants}
            initial="initial"
            whileInView="whileInView"
            viewport={{ once: true }}
          >
            {/* Split the title string and map over it */}
            {"Welcome to EventX".split(" ").map((word, index) => {
              // If the word is "EventX", split it into "Event" + "X"
              if (word === "EventX") {
                return (
                  <motion.span
                    key={index}
                    variants={heroTitleWordVariants}
                    style={{ display: "inline-block", marginRight: "0.5rem" }}
                  >
                    Event
                    <span style={{ color: "rgba(255, 253, 253, 1)" }}>X</span>
                  </motion.span>
                );
              }
            
              return (
                <motion.span
                  key={index}
                  variants={heroTitleWordVariants}
                  style={{ display: "inline-block", marginRight: "0.5rem" }}
                >
                  {word}
                </motion.span>
              );
            })}

          </motion.h1>

          <motion.p
            className="hero-p text-xl mb-8 text-white/90"
            {...FADE_UP_VARIANT}
            // ✅ MODIFIED: Increased delay to animate *after* the title
            transition={{ ...FADE_UP_VARIANT.transition, delay: 0.8 }}
          >
            Your central hub for hackathons, workshops, and tech events from
            every club on campus.
          </motion.p>

          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <motion.div
              className="hero-button"
              {...FADE_UP_VARIANT}
              // ✅ MODIFIED: Increased delay
              transition={{ ...FADE_UP_VARIANT.transition, delay: 1.0 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Link href="/events">
                <Button className="bg-white text-brand-red font-semibold hover:bg-gray-100 w-full">
                  Browse Events
                </Button>
              </Link>
            </motion.div>

            <motion.div
              className="hero-button"
              {...FADE_UP_VARIANT}
              // ✅ MODIFIED: Increased delay
              transition={{ ...FADE_UP_VARIANT.transition, delay: 1.1 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Link href="/contact">
                <Button
                  variant="outline"
                  className="text-white border-white hover:bg-white hover:text-brand-red w-full"
                >
                  Contact Us
                </Button>
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CLUBS SECTION */}
      <section className="py-16 bg-card">
        <div className="container mx-auto px-4">
          <motion.h2
            className="club-section-title text-3xl font-bold text-center mb-12"
            {...FADE_UP_VARIANT}
          >
            <LastWordGradientText>Browse by Club</LastWordGradientText>
          </motion.h2>

          {clubs.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-6">
              {clubs.map((club, index) => (
                <motion.div
                  key={club.club_name}
                  className="club-card h-full"
                  {...FADE_UP_VARIANT}
                  transition={{
                    ...FADE_UP_VARIANT.transition,
                    delay: index * 0.05,
                  }}
                  whileHover={{ scale: 1.03, y: -5 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Link
                    href={`/events?club=${encodeURIComponent(club.club_name)}`}
                    className="group"
                  >
                    <Card className="h-full hover:shadow-xl bg-background hover:bg-zinc-900 transition-shadow duration-300">
                      <CardContent className="pt-6 text-center flex flex-col items-center">
                        <div className="relative w-24 h-24 mb-4">
                          <Image
                            src={club.club_logo_url}
                            alt={club.club_name}
                            fill
                            className="object-contain rounded-full border-2 border-border group-hover:border-brand-orange transition-colors"
                            sizes="(max-width: 768px) 100px, 100px"
                          />
                        </div>
                        <h3 className="text-md text-gray-100 font-semibold group-hover:text-brand-orange transition-colors">
                          {club.club_name}
                        </h3>
                      </CardContent>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-gray-500">
                <Building size={48} className="mx-auto mb-4 text-gray-400" />
                <p>No clubs available yet. Check back soon!</p>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* UPCOMING EVENTS */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div
            className="flex justify-between items-center mb-8"
            {...FADE_UP_VARIANT}
          >
            <h2 className="event-section-title text-3xl font-bold">
              <LastWordGradientText>Upcoming Events</LastWordGradientText>
            </h2>

            <Link href="/events">
              <Button variant="outline">View All Events</Button>
            </Link>
          </motion.div>

          {upcomingEvents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {upcomingEvents.map((event, index) => (
                <motion.div
                  key={event.id}
                  className="event-card h-full"
                  {...FADE_UP_VARIANT}
                  transition={{
                    ...FADE_UP_VARIANT.transition,
                    delay: index * 0.1,
                  }}
                  whileHover={{ scale: 1.03, y: -5 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <EventCard event={event} />
                </motion.div>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-gray-500">
                <p>No events open for registration. Check back soon!</p>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* ABOUT SECTION */}
      <section className="py-16 bg-card">
        <div className="container mx-auto px-4">
          <motion.div
            className="about-section max-w-3xl mx-auto text-center"
            {...FADE_UP_VARIANT}
          >
            <h2 className="text-3xl font-bold mb-6">
              <GradientText>About EventX</GradientText>
            </h2>

            <p className="text-gray-400 mb-4">
              EventX is your college’s central platform for discovering and
              managing technical and non-technical events.
            </p>

            <p className="text-gray-400 mb-6">
              Our mission is to bring all student-run clubs together, helping
              students find opportunities easily and helping clubs manage their
              participants effortlessly.
            </p>

            <Link href="/events">
              <Button className="bg-brand-gradient text-white font-semibold hover:opacity-90">
                Join Our Next Event
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
