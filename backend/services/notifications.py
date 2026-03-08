"""
Notification Service
Dispatches SOS alerts via SMS (Twilio), FCM push, and email
"""
import os
import asyncio
from services.firebase import send_fcm_notification


class NotificationService:
    def __init__(self):
        self.twilio_sid = os.getenv("TWILIO_ACCOUNT_SID")
        self.twilio_token = os.getenv("TWILIO_AUTH_TOKEN")
        self.twilio_from = os.getenv("TWILIO_FROM_NUMBER", "+1234567890")
        self.police_email = os.getenv("POLICE_ALERT_EMAIL", "police@emergency.gov.in")

    async def dispatch_sos_alerts(
        self,
        sos_payload: dict,
        emergency_contact_1: str,
        emergency_contact_2: str,
        fcm_token: str = None,
    ):
        """Dispatch all SOS notifications concurrently."""
        tasks = []

        # SMS to emergency contacts
        for contact in [emergency_contact_1, emergency_contact_2]:
            if contact:
                tasks.append(self._send_sms(contact, self._sos_sms_body(sos_payload)))

        # Push notification
        if fcm_token:
            tasks.append(send_fcm_notification(
                token=fcm_token,
                title="🚨 SOS ACTIVATED",
                body=f"SOS has been activated. Location: {sos_payload['maps_link']}",
                data={"sos_id": sos_payload["sos_id"], "type": "sos"},
            ))

        # Log notification attempt
        tasks.append(self._log_alert(sos_payload))

        await asyncio.gather(*tasks, return_exceptions=True)

    def _sos_sms_body(self, payload: dict) -> str:
        return (
            f"🚨 EMERGENCY ALERT from AegisHer\n"
            f"Name: {payload['user_name']}\n"
            f"Phone: {payload['user_phone']}\n"
            f"Location: {payload['maps_link']}\n"
            f"Time: {payload['timestamp']}\n"
            f"Please respond immediately!"
        )

    async def _send_sms(self, to: str, body: str):
        """Send SMS via Twilio."""
        if not self.twilio_sid:
            print(f"[SMS] Twilio not configured. Would send to {to}: {body[:60]}...")
            return
        try:
            from twilio.rest import Client
            client = Client(self.twilio_sid, self.twilio_token)
            message = client.messages.create(body=body, from_=self.twilio_from, to=to)
            print(f"[SMS] Sent to {to}: {message.sid}")
        except Exception as e:
            print(f"[SMS] Failed: {e}")

    async def _log_alert(self, payload: dict):
        """Update SOS log with notification status."""
        try:
            from services.firebase import get_firestore
            from datetime import datetime
            db = get_firestore()
            db.collection("EmergencyLogs").document(payload["sos_id"]).update({
                "notifications_sent": True,
                "notification_time": datetime.utcnow().isoformat(),
            })
        except Exception as e:
            print(f"[Log] Alert log update failed: {e}")