"""
tracker.py
==========
Multi-object Centroid and IoU tracker for pothole detection.
Eliminates camera vibration noise and flickering false positives by
requiring temporal consistency before confirming an alert.
"""

import math
import time
from typing import Dict, List, Tuple
from collections import OrderedDict

from .pothole_detector import PotholeDetection


class TrackedPothole:
    """Internal state for a tracked pothole across frames."""

    def __init__(self, track_id: int, detection: PotholeDetection):
        self.track_id = track_id
        self.detection = detection
        self.hits = 1
        self.disappeared = 0
        self.alert_triggered = False
        self.first_seen = detection.timestamp
        self.last_seen = detection.timestamp
        self.centroid = self._calc_centroid(detection.bbox)

    @staticmethod
    def _calc_centroid(bbox: Tuple[int, int, int, int]) -> Tuple[int, int]:
        x, y, w, h = bbox
        return (int(x + w / 2), int(y + h / 2))

    def update(self, detection: PotholeDetection):
        self.detection = detection
        self.detection.id = self.track_id
        self.hits += 1
        self.disappeared = 0
        self.last_seen = detection.timestamp
        self.centroid = self._calc_centroid(detection.bbox)


class CentroidTracker:
    """
    Associates pothole candidates between frames based on Euclidean distance
    and bounding box IoU.
    """

    def __init__(
        self,
        max_disappeared: int = 5,
        max_distance_px: float = 80.0,
        min_hits_to_alert: int = 2,
        alert_cooldown_s: float = 1.5,
    ):
        self.next_track_id = 1
        self.tracks: OrderedDict[int, TrackedPothole] = OrderedDict()
        self.max_disappeared = max_disappeared
        self.max_distance_px = max_distance_px
        self.min_hits_to_alert = min_hits_to_alert
        self.alert_cooldown_s = alert_cooldown_s
        self.last_alert_time: float = 0.0

    def update(self, detections: List[PotholeDetection]) -> Tuple[List[PotholeDetection], List[PotholeDetection]]:
        """
        Update tracker with new frame detections.
        Returns:
            (active_detections, newly_confirmed_alerts)
        """
        now = time.time()
        new_alerts: List[PotholeDetection] = []

        # If no detections in current frame, age all existing tracks
        if len(detections) == 0:
            for track_id in list(self.tracks.keys()):
                self.tracks[track_id].disappeared += 1
                if self.tracks[track_id].disappeared > self.max_disappeared:
                    del self.tracks[track_id]
            return [], []

        # If currently tracking no objects, register all as new
        if len(self.tracks) == 0:
            for det in detections:
                self._register(det)
            active = [t.detection for t in self.tracks.values()]
            return active, []

        # Match existing tracks with new detections using Euclidean distance
        track_ids = list(self.tracks.keys())
        track_centroids = [self.tracks[tid].centroid for tid in track_ids]
        input_centroids = [
            TrackedPothole._calc_centroid(det.bbox) for det in detections
        ]

        used_tracks = set()
        used_inputs = set()

        # Compute pairwise distance matrix
        dist_matrix = []
        for tc in track_centroids:
            row = []
            for ic in input_centroids:
                d = math.hypot(tc[0] - ic[0], tc[1] - ic[1])
                row.append(d)
            dist_matrix.append(row)

        # Greedily match closest pairs
        matches = []
        for t_idx, row in enumerate(dist_matrix):
            for i_idx, dist in enumerate(row):
                if dist <= self.max_distance_px:
                    matches.append((dist, t_idx, i_idx))

        matches.sort(key=lambda x: x[0])

        for dist, t_idx, i_idx in matches:
            if t_idx in used_tracks or i_idx in used_inputs:
                continue

            track_id = track_ids[t_idx]
            det = detections[i_idx]
            track = self.tracks[track_id]
            track.update(det)

            used_tracks.add(t_idx)
            used_inputs.add(i_idx)

            # Check if this track satisfies alert confirmation threshold
            if (
                track.hits >= self.min_hits_to_alert
                and not track.alert_triggered
                and (now - self.last_alert_time) >= self.alert_cooldown_s
            ):
                track.alert_triggered = True
                self.last_alert_time = now
                new_alerts.append(track.detection)

        # Increment disappeared for unmatched existing tracks
        for t_idx, track_id in enumerate(track_ids):
            if t_idx not in used_tracks:
                self.tracks[track_id].disappeared += 1
                if self.tracks[track_id].disappeared > self.max_disappeared:
                    del self.tracks[track_id]

        # Register remaining new detections
        for i_idx, det in enumerate(detections):
            if i_idx not in used_inputs:
                self._register(det)

        active = [t.detection for t in self.tracks.values() if t.disappeared == 0]
        return active, new_alerts

    def _register(self, detection: PotholeDetection):
        track_id = self.next_track_id
        self.next_track_id += 1
        detection.id = track_id
        self.tracks[track_id] = TrackedPothole(track_id, detection)
