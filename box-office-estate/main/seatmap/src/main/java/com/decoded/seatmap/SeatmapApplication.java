/*
 * seatmap: entry point of the seat availability and holds service.
 * Part of box-office-estate, the application behind module 07,
 * lab 07-hackathon-two-worlds. No lab task edits a Java source file.
 */
package com.decoded.seatmap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SeatmapApplication {

    public static void main(String[] args) {
        SpringApplication.run(SeatmapApplication.class, args);
    }
}
